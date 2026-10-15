/* ═══════════════════════════════════════════════════════════════════════════
   Clients Supabase côté serveur.
   ═══════════════════════════════════════════════════════════════════════════ */
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { env } from './env';

// ═══════════════════════════════════════════════════════════════
// 🔑 CLÉS SUPABASE À INSÉRER ICI
// ────────────────────────────────────────────────────────────────
// 1. Va sur https://supabase.com/dashboard → ton projet
// 2. Project Settings → API (ou « API Keys »)
// 3. Ajoute dans ton fichier .env.local (et dans Vercel → Settings
//    → Environment Variables pour la production) :
//      SUPABASE_URL=https://xxxxxxxx.supabase.co
//      SUPABASE_ANON_KEY=eyJhbGciOi...        (clé « anon » / publishable)
//      SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi... (clé « service_role » / secret)
// 4. Redémarre le serveur : npm run dev
//
// ⚠️ La clé service_role contourne la sécurité RLS : elle ne doit
//    JAMAIS apparaître dans le navigateur ni dans un fichier .html/.js
//    public. Elle n'est lue qu'ici, dans les fonctions serverless.
// ═══════════════════════════════════════════════════════════════
let adminClient: SupabaseClient | null = null;

/** Client administrateur (service_role) — contourne RLS. Serveur uniquement. */
export function admin(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(
      env('SUPABASE_URL'),
      env('SUPABASE_SERVICE_ROLE_KEY'), // ⬅️ LA CLÉ SERVICE_ROLE EST ICI
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return adminClient;
}

/** Client « au nom de l'utilisateur » : RLS et auth.uid() s'appliquent. */
export function asUser(jwt: string): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Client anonyme (inscription, connexion, réinitialisation de mot de passe). */
export function anon(): SupabaseClient {
  return createClient(
    env('SUPABASE_URL'),
    env('SUPABASE_ANON_KEY'), // ⬅️ LA CLÉ ANON EST ICI (publique, protégée par RLS)
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Vérifie un JWT Supabase et renvoie l'utilisateur, ou null. */
export async function userFromJwt(jwt: string): Promise<User | null> {
  const { data, error } = await admin().auth.getUser(jwt);
  if (error || !data?.user) return null;
  return data.user;
}
