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
import { aiConfigured } from '../../lib/ai/openai';
import { waitUntil } from '@vercel/functions';

/* L'analyse (lecture du fichier + IA) peut prendre plus d'une minute. Le serveur répond donc
   TOUT DE SUITE (« analyse en cours ») et continue le travail en arrière-plan (waitUntil) :
   le téléphone n'a plus à garder une connexion ouverte, que les réseaux mobiles coupent
   (« Failed to fetch »). La page suit la progression en temps réel, et une notification
   « … est prêt ✨ » arrive à la fin. */
function inBackground(work: Promise<unknown>) {
  waitUntil(work.catch((e) => console.error('[documents] analyse échouée :', e instanceof Error ? e.message : e)));
}
const PUBLIC_COLS = 'id, title, subject, status, status_message, progress, page_count, word_count, summary_short, key_concepts, created_at';
function pick(d: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of PUBLIC_COLS.split(', ')) out[k] = d[k];
  return out;
}

const Body = z
  .object({
    path: z.string().max(400).optional(),
    file_name: z.string().max(255).optional(),
    title: z.string().max(200).optional(),
    subject: z.string().max(60).optional(),
    text: z.string().max(400_000).optional(),
    source: z.enum(['upload', 'note', 'text']).default('upload'),
    document_id: z.string().uuid().optional(),
  })
  .refine((b) => !!b.path || !!b.text || !!b.document_id, { message: 'path, text ou document_id requis' });

/** Relance l'analyse d'un document resté en attente ou en échec. */
async function relaunch(id: string, userId: string) {
  const sb = admin();
  const { data: doc } = await sb.from('documents').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  if (!doc) throw new HttpError(404, 'document_not_found', 'Document introuvable.');
  if (doc.status === 'ready' || doc.status === 'processing') throw new HttpError(409, 'already_processed', 'Ce document est déjà analysé.');
  let buffer: Buffer | undefined;
  let mime: string | undefined;
  let text: string | undefined;
  if (doc.file_path) {
    const { data: blob, error } = await sb.storage.from('documents').download(doc.file_path);
    if (error || !blob) throw new HttpError(404, 'file_not_found', 'Fichier introuvable dans ton espace de stockage.');
    buffer = Buffer.from(await blob.arrayBuffer());
    mime = sniffMime(buffer, doc.file_name || doc.file_path) || undefined;
  } else {
    const { data: chunks } = await sb.from('document_chunks').select('content').eq('document_id', id).order('chunk_index');
    text = (chunks || []).map((c) => c.content).join('\n\n');
  }
  await sb.from('documents').update({ status: 'processing', progress: 5, status_message: 'Analyse relancée…' }).eq('id', id);
  inBackground(processDocument({ docId: id, userId, buffer, mime, text, title: doc.title, skipXp: true }));
  const { data: fresh } = await sb.from('documents').select(PUBLIC_COLS).eq('id', id).single();
  return { document: fresh, background: true };
}

export default route(
  { methods: ['POST'], auth: true, rateLimit: { key: (c) => `doc:${c.user!.id}`, max: 30, windowSec: 3600 } },
  async ({ req, user }) => {
    const body = parse(Body, req.body);
    // Sans clé IA : le navigateur enregistre le document « en attente » (register_document)
    if (!aiConfigured()) throw new HttpError(503, 'ai_not_configured', "L'IA n'est pas encore configurée.");
    if (body.document_id) return relaunch(body.document_id, user.id);
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
      // Même fichier envoyé deux fois (le téléphone a réessayé après une coupure) : on renvoie le document existant
      const { data: existing } = await sb.from('documents').select(PUBLIC_COLS).eq('user_id', user.id).eq('file_path', body.path).maybeSingle();
      if (existing) return { document: existing, background: existing.status !== 'ready' };
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

    inBackground(processDocument({ docId: doc.id, userId: user.id, buffer, mime, text: body.text, title: doc.title }));
    return { document: { ...pick(doc), status: 'processing', progress: 5, status_message: 'Lecture du document…' }, background: true };
  },
);
