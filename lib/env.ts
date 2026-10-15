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
  return envOptional('APP_URL', 'http://localhost:3000').replace(/\/+$/, '');
}
