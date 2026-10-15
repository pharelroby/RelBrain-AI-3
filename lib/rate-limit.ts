/* Limitation de débit adossée à Postgres (fonction atomique rate_limit_hit).
   Pas de Redis requis ; suffisant jusqu'à plusieurs milliers de req/min. */
import { admin } from './supabase';

export async function hit(key: string, max: number, windowSec: number): Promise<boolean> {
  const { data, error } = await admin().rpc('rate_limit_hit', {
    p_key: key.slice(0, 200),
    p_max: max,
    p_window_seconds: windowSec,
  });
  if (error) {
    // En cas de panne de la base, on laisse passer plutôt que de bloquer tout le site.
    console.warn('[rate-limit] indisponible', error.message);
    return true;
  }
  return data === true;
}
