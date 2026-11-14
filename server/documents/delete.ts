/* POST /api/documents/delete { id } — supprime le document, ses chunks,
   résumés (cascade SQL) et le fichier du bucket. */
import { z } from 'zod';
import { route, parse, HttpError } from '../../lib/http';
import { admin } from '../../lib/supabase';

const Body = z.object({ id: z.string().uuid() });

export default route({ methods: ['POST', 'DELETE'], auth: true }, async ({ req, user }) => {
  const { id } = parse(Body, req.method === 'DELETE' ? req.query : req.body);
  const sb = admin();
  const { data: doc } = await sb.from('documents').select('id, file_path').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (!doc) throw new HttpError(404, 'document_not_found', 'Document introuvable.');
  if (doc.file_path) {
    const { error } = await sb.storage.from('documents').remove([doc.file_path]);
    if (error) console.warn('[documents] fichier non supprimé', error.message);
  }
  const { error } = await sb.from('documents').delete().eq('id', id).eq('user_id', user.id);
  if (error) throw new HttpError(500, 'delete_failed', 'Suppression impossible pour le moment.');
  return { ok: true };
});
