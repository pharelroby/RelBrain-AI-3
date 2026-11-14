/* ═══════════════════════════════════════════════════════════════════════════
   Lecture centralisée des variables d'environnement.
   Toutes les clés sont listées et documentées dans .env.example.
   ═══════════════════════════════════════════════════════════════════════════ */
import { HttpError } from './http';

export function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new HttpError(
      503,
      'config_missing',
      `Configuration incomplète : la variable ${name} n'est pas définie. Voir .env.example.`,
    );
  }
  return value;
}

export function envOptional(name: string, fallback = ''): string {
  return process.env[name] || fallback;
}

/** URL publique du site, sans slash final (liens des emails, redirections OAuth/paiement). */
export function appUrl(): string {
  // 1. APP_URL si tu l'as réglée (utile avec un nom de domaine à toi)
  // 2. Sinon, sur Vercel : l'adresse de production fournie automatiquement par Vercel
  // 3. Sinon : ton ordinateur
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return envOptional('APP_URL', vercel ? `https://${vercel}` : 'http://localhost:3000').replace(/\/+$/, '');
}
