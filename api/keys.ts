/* /api/keys — gestion des clés de l'API publique (forfaits Pro et Premium).
   GET liste · POST { name, scopes } crée (clé affichée une seule fois) · DELETE { id } révoque */
import { z } from 'zod';
import { route, parse, HttpError } from '../lib/http';
import { admin } from '../lib/supabase';
import { getQuota } from '../lib/quota';
import { generateKey } from '../lib/api-keys';

export default route({ methods: ['GET', 'POST', 'DELETE'], auth: true }, async ({ req, user }) => {
  const sb = admin();
  if (req.method === 'GET') {
    const { data } = await sb
      .from('api_keys')
      .select('id, name, key_prefix, scopes, last_used_at, revoked_at, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    return { keys: data || [] };
  }

  if (req.method === 'POST') {
    const body = parse(z.object({ name: z.string().trim().min(1).max(60), scopes: z.array(z.enum(['read', 'write'])).min(1).default(['read']) }), req.body);
    const quota = await getQuota(user.id);
    if (quota.plan === 'free') throw new HttpError(402, 'feature_locked', "L'API publique est incluse dans les forfaits Pro et Premium.");
    const { count } = await sb.from('api_keys').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('revoked_at', null);
    if ((count || 0) >= 5) throw new HttpError(400, 'too_many_keys', 'Maximum 5 clés actives. Révoque une clé inutilisée.');
    const k = generateKey();
    const { data, error } = await sb
      .from('api_keys')
      .insert({ user_id: user.id, name: body.name, key_prefix: k.prefix, key_hash: k.hash, scopes: body.scopes })
      .select('id, name, key_prefix, scopes, created_at')
      .single();
    if (error) throw new HttpError(500, 'key_failed', 'Création de la clé impossible.');
    return { key: k.key, info: data, warning: 'Copie cette clé maintenant : elle ne sera plus jamais affichée.' };
  }

  const { id } = parse(z.object({ id: z.string().uuid() }), req.body);
  await sb.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
  return { ok: true };
});
