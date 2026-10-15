/* POST /api/documents/process — enregistre et analyse un document.
   Deux entrées possibles :
   · { path, file_name, title?, subject? } : fichier déjà déposé par le navigateur
     dans le bucket privé « documents » sous {user_id}/… (RLS Storage) ;
   · { text, title, source: 'note' | 'text' } : note ou texte collé.
   Le statut (pending → processing → ready/failed) et la progression sont
   diffusés en temps réel via Supabase Realtime sur la table documents.   */
import { z } from 'zod';
import { route, parse, HttpError } from '../../lib/http';
import { admin } from '../../lib/supabase';
import { assertQuota, assertAiBurst } from '../../lib/quota';
import { ALLOWED_MIME, MAX_BYTES, sniffMime } from '../../lib/extract';
import { processDocument } from '../../lib/documents';

const Body = z
  .object({
    path: z.string().max(400).optional(),
    file_name: z.string().max(255).optional(),
    title: z.string().max(200).optional(),
    subject: z.string().max(60).optional(),
    text: z.string().max(400_000).optional(),
    source: z.enum(['upload', 'note', 'text']).default('upload'),
  })
  .refine((b) => !!b.path || !!b.text, { message: 'path ou text requis' });

export default route(
  { methods: ['POST'], auth: true, rateLimit: { key: (c) => `doc:${c.user!.id}`, max: 30, windowSec: 3600 } },
  async ({ req, user }) => {
    const body = parse(Body, req.body);
    const quota = await assertQuota(user.id, 'documents');
    await assertAiBurst(user.id, quota.plan);
    const sb = admin();

    let buffer: Buffer | undefined;
    let mime: string | undefined;
    let size: number | undefined;
    if (body.path) {
      // Le chemin doit appartenir à l'utilisateur : {user_id}/{fichier}
      if (!body.path.startsWith(`${user.id}/`) || body.path.includes('..')) {
        throw new HttpError(403, 'forbidden_path', 'Ce fichier ne t\'appartient pas.');
      }
      const { data: blob, error } = await sb.storage.from('documents').download(body.path);
      if (error || !blob) throw new HttpError(404, 'file_not_found', 'Fichier introuvable dans ton espace de stockage.');
      buffer = Buffer.from(await blob.arrayBuffer());
      size = buffer.length;
      const maxBytes = Math.min(MAX_BYTES, quota.max_file_mb * 1024 * 1024);
      if (size > maxBytes) {
        await sb.storage.from('documents').remove([body.path]);
        throw new HttpError(413, 'file_too_large', `Fichier trop volumineux (max ${quota.max_file_mb} Mo avec ton forfait).`);
      }
      mime = sniffMime(buffer, body.file_name || body.path) || undefined;
      if (!mime || !ALLOWED_MIME.has(mime)) {
        await sb.storage.from('documents').remove([body.path]);
        throw new HttpError(415, 'unsupported_type', 'Format non reconnu. Formats acceptés : PDF, DOCX, PPTX, TXT, MD, PNG, JPG, WEBP.');
      }
    }

    const fallbackTitle = (body.file_name || 'Mon cours').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').trim();
    const { data: doc, error: insErr } = await sb
      .from('documents')
      .insert({
        user_id: user.id,
        title: (body.title || fallbackTitle || 'Mon cours').slice(0, 200),
        subject: body.subject || null,
        source: body.path ? 'upload' : body.source,
        file_path: body.path || null,
        file_name: body.file_name || null,
        mime_type: mime || 'text/plain',
        size_bytes: size ?? (body.text ? Buffer.byteLength(body.text) : null),
        status: 'pending',
      })
      .select('*')
      .single();
    if (insErr || !doc) throw new HttpError(500, 'document_insert_failed', "Impossible d'enregistrer le document.");

    const result = await processDocument({ docId: doc.id, userId: user.id, buffer, mime, text: body.text, title: doc.title });
    const { data: fresh } = await sb
      .from('documents')
      .select('id, title, subject, status, status_message, progress, page_count, word_count, summary_short, key_concepts, created_at')
      .eq('id', doc.id)
      .single();
    return { document: fresh, analysis: result.analysis, xp: result.xp, warning: result.warning };
  },
);
