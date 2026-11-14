/* ═══════════════════════════════════════════════════════════════════════════
   L'AIGUILLEUR DES ROUTES /api
   ───────────────────────────────────────────────────────────────────────────
   Pourquoi ? Le plan gratuit de Vercel accepte 12 fonctions serveur au plus,
   et RelBrain en a 25. Toutes les adresses /api/... arrivent donc ici
   (voir « rewrites » dans vercel.json), puis ce fichier appelle le bon
   fichier du dossier server/. Pour les pages du site, rien ne change.

   ➕ AJOUTER UNE ROUTE
      1. Crée le fichier, par exemple server/ma-route.ts
      2. Ajoute une ligne dans ROUTES ci-dessous :
         'ma-route': () => import('../server/ma-route'),
      3. Elle répond sur /api/ma-route
   ═══════════════════════════════════════════════════════════════════════════ */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendError, HttpError } from '../lib/http';

// Chaque route n'est chargée qu'au moment où on l'appelle (démarrage plus rapide).
export const ROUTES: Record<string, () => Promise<any>> = {
  'account/delete': () => import('../server/account/delete'),
  'account/export': () => import('../server/account/export'),
  'admin': () => import('../server/admin'),
  'ai/analyze': () => import('../server/ai/analyze'),
  'ai/chat': () => import('../server/ai/chat'),
  'ai/flashcards': () => import('../server/ai/flashcards'),
  'ai/quiz': () => import('../server/ai/quiz'),
  'ai/summary': () => import('../server/ai/summary'),
  'auth/login': () => import('../server/auth/login'),
  'auth/recover': () => import('../server/auth/recover'),
  'auth/resend': () => import('../server/auth/resend'),
  'auth/signup': () => import('../server/auth/signup'),
  'contact': () => import('../server/contact'),
  'cron/notifications': () => import('../server/cron/notifications'),
  'cron/subscriptions': () => import('../server/cron/subscriptions'),
  'documents/delete': () => import('../server/documents/delete'),
  'documents/process': () => import('../server/documents/process'),
  'health': () => import('../server/health'),
  'keys': () => import('../server/keys'),
  'notifications/subscribe': () => import('../server/notifications/subscribe'),
  'payments/checkout': () => import('../server/payments/checkout'),
  'payments/status': () => import('../server/payments/status'),
  'v1/quizzes': () => import('../server/v1/quizzes'),
  'webhooks/mobile-money': () => import('../server/webhooks/mobile-money'),
  'webhooks/stripe': () => import('../server/webhooks/stripe'),
};

/** Nom de la route demandée : « ai/chat » pour /api/ai/chat. */
export function routeName(req: VercelRequest): string {
  const q = req.query.__route;
  const fromQuery = Array.isArray(q) ? q.join('/') : q;
  const fromUrl = (req.url || '').split('?')[0].replace(/^\/api\/?/, '');
  return String(fromQuery || fromUrl).replace(/^\/+|\/+$/g, '');
}

export default async function router(req: VercelRequest, res: VercelResponse) {
  const name = routeName(req);
  delete (req.query as Record<string, unknown>).__route;
  const load = Object.prototype.hasOwnProperty.call(ROUTES, name) ? ROUTES[name] : null;
  if (!load) return sendError(res, new HttpError(404, 'not_found', 'Route inconnue.'));
  const mod = await load();
  const handler = mod.default?.default ?? mod.default;
  return handler(req, res);
}
