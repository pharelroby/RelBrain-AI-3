/* ═══════════════════════════════════════════════════════════════════════════
   Socle HTTP des routes /api : méthodes, CORS, authentification, limitation
   de débit, erreurs JSON homogènes { error: { code, message } }.
   ═══════════════════════════════════════════════════════════════════════════ */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { User } from '@supabase/supabase-js';
import type { ZodType, ZodTypeDef } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export interface Ctx {
  req: VercelRequest;
  res: VercelResponse;
  ip: string;
  user: User | null;
  jwt: string | null;
}
export interface AuthedCtx extends Ctx {
  user: User;
  jwt: string;
}

interface RouteOptions {
  methods: string[];
  auth?: boolean;
  /** Limitation de débit : clé (ex. « login:ip ») + max requêtes par fenêtre. */
  rateLimit?: { key: (ctx: Ctx) => string; max: number; windowSec: number };
  /** CORS ouvert (API publique /api/v1). Par défaut : même origine + APP_URL. */
  publicCors?: boolean;
}

export function clientIp(req: VercelRequest): string {
  // x-real-ip et x-vercel-forwarded-for sont posés par Vercel lui-même : un visiteur ne peut pas les falsifier
  // (contrairement au début de x-forwarded-for). Indispensable pour que les limites par IP tiennent.
  const h = (k: string) => (req.headers[k] as string | undefined)?.split(',')[0]?.trim();
  return h('x-real-ip') || h('x-vercel-forwarded-for') || h('x-forwarded-for') || req.socket?.remoteAddress || 'unknown';
}

/** Taille maximale d'une requête (les fichiers partent directement vers le stockage, pas par ici). */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export function bearer(req: VercelRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

function cors(req: VercelRequest, res: VercelResponse, open: boolean) {
  const origin = req.headers.origin as string | undefined;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const allowed = [process.env.APP_URL, vercel && `https://${vercel}`, 'http://localhost:3000', 'http://127.0.0.1:3000'].filter(Boolean);
  if (open) res.setHeader('Access-Control-Allow-Origin', '*');
  else if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Request-Id');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, input: unknown): T {
  const r = schema.safeParse(input ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    throw new HttpError(400, 'invalid_input', `Champ invalide : ${first?.path.join('.') || 'requête'} — ${first?.message}`, r.error.flatten());
  }
  return r.data;
}

export function route(opts: RouteOptions & { auth: true }, fn: (ctx: AuthedCtx) => Promise<unknown>): (req: VercelRequest, res: VercelResponse) => Promise<void>;
export function route(opts: RouteOptions, fn: (ctx: Ctx) => Promise<unknown>): (req: VercelRequest, res: VercelResponse) => Promise<void>;
export function route(opts: RouteOptions, fn: (ctx: any) => Promise<unknown>) {
  return async (req: VercelRequest, res: VercelResponse) => {
    cors(req, res, !!opts.publicCors);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    try {
      if (!opts.methods.includes(req.method || '')) {
        res.setHeader('Allow', opts.methods.join(', '));
        throw new HttpError(405, 'method_not_allowed', 'Méthode non autorisée.');
      }
      if (Number(req.headers['content-length'] || 0) > MAX_BODY_BYTES) {
        throw new HttpError(413, 'payload_too_large', 'Requête trop volumineuse.');
      }
      const ctx: Ctx = { req, res, ip: clientIp(req), user: null, jwt: null };

      if (opts.auth) {
        const jwt = bearer(req);
        if (!jwt) throw new HttpError(401, 'unauthenticated', 'Connecte-toi pour continuer.');
        const { userFromJwt } = await import('./supabase');
        const user = await userFromJwt(jwt);
        if (!user) throw new HttpError(401, 'session_expired', 'Ta session a expiré. Reconnecte-toi.');
        ctx.user = user;
        ctx.jwt = jwt;
      }

      if (opts.rateLimit) {
        const { hit } = await import('./rate-limit');
        const ok = await hit(opts.rateLimit.key(ctx), opts.rateLimit.max, opts.rateLimit.windowSec);
        if (!ok) {
          res.setHeader('Retry-After', String(opts.rateLimit.windowSec));
          throw new HttpError(429, 'rate_limited', 'Trop de tentatives. Patiente quelques minutes avant de réessayer.');
        }
      }

      const result = await fn(ctx);
      if (!res.headersSent && !res.writableEnded) {
        if (result === undefined) res.status(204).end();
        else res.status(200).json(result);
      }
    } catch (err) {
      sendError(res, err);
    }
  };
}

export function sendError(res: VercelResponse, err: unknown) {
  if (res.headersSent) {
    try { res.end(); } catch { /* flux déjà fermé */ }
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  console.error('[api] erreur inattendue', err);
  res.status(500).json({ error: { code: 'internal_error', message: 'Une erreur inattendue est survenue. Réessaie dans un instant.' } });
}

/** Lit le corps brut (webhooks signés : Stripe…). Ne pas accéder à req.body avant. */
export async function rawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}
