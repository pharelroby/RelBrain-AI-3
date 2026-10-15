/* Clés de l'API publique RelBrain (format : rb_live_<43 caractères>).
   Seule l'empreinte SHA-256 est stockée ; la clé n'est affichée qu'une fois. */
import { createHash, randomBytes } from 'crypto';
import type { VercelRequest } from '@vercel/node';
import { admin } from './supabase';
import { HttpError, bearer } from './http';
import { hit } from './rate-limit';

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

export function generateKey() {
  const key = `rb_live_${randomBytes(32).toString('base64url')}`;
  return { key, prefix: key.slice(0, 12), hash: hashKey(key) };
}

/** Authentifie une requête de l'API publique. 60 requêtes / minute / clé. */
export async function authenticateApiKey(req: VercelRequest, scope: 'read' | 'write' = 'read') {
  const key = bearer(req) || (req.headers['x-api-key'] as string | undefined) || null;
  if (!key || !key.startsWith('rb_live_')) throw new HttpError(401, 'missing_api_key', 'Clé API manquante (en-tête Authorization: Bearer rb_live_…).');
  const { data } = await admin().from('api_keys').select('id, user_id, scopes, revoked_at').eq('key_hash', hashKey(key)).maybeSingle();
  if (!data || data.revoked_at) throw new HttpError(401, 'invalid_api_key', 'Clé API invalide ou révoquée.');
  if (!data.scopes.includes(scope)) throw new HttpError(403, 'insufficient_scope', `Cette clé n'a pas la permission « ${scope} ».`);
  if (!(await hit(`apikey:${data.id}`, 60, 60))) throw new HttpError(429, 'rate_limited', 'Limite de 60 requêtes par minute atteinte.');
  await admin().from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
  return { userId: data.user_id as string, keyId: data.id as string };
}
