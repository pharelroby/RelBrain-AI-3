/* ═══════════════════════════════════════════════════════════════════════════
   Client OpenAI + garde-fous : retry exponentiel, timeout, modèle de repli,
   validation JSON (zod), suivi des tokens et du coût dans « ai_usage ».
   ═══════════════════════════════════════════════════════════════════════════ */
import OpenAI from 'openai';
import type { ZodType, ZodTypeDef } from 'zod';
import { HttpError } from '../http';
import { admin } from '../supabase';

// ═══════════════════════════════════════════════════════════════
// 🔑 CLÉ API À INSÉRER ICI (dans .env.local, jamais dans ce fichier)
// ────────────────────────────────────────────────────────────────
// GEMINI (gratuit pour les tests) — prioritaire si la clé est présente
// 1. Va sur https://aistudio.google.com/apikey → « Create API key »
// 2. Dans .env.local :  GEMINI_API_KEY=ta_cle
// 3. Enregistre : le serveur local redémarre tout seul.
//    En production : Vercel → Settings → Environment Variables.
//
// OPENAI (plus tard) : retire GEMINI_API_KEY et renseigne OPENAI_API_KEY.
// ═══════════════════════════════════════════════════════════════
const GEMINI_KEY = process.env.GEMINI_API_KEY; // ⬅️ LA CLÉ EST ICI (Gemini)
const OPENAI_KEY = process.env.OPENAI_API_KEY; // ⬅️ LA CLÉ EST ICI (OpenAI)
export const PROVIDER: 'gemini' | 'openai' | null = GEMINI_KEY ? 'gemini' : OPENAI_KEY ? 'openai' : null;
const isGemini = PROVIDER === 'gemini';
const GEMINI_BASE = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');

export function aiConfigured(): boolean {
  return PROVIDER !== null;
}

let client: OpenAI | null = null;
export function openai(): OpenAI {
  if (!PROVIDER) {
    throw new HttpError(503, 'ai_not_configured', "L'IA n'est pas encore configurée : ajoute GEMINI_API_KEY dans .env.local.");
  }
  if (!client) {
    client = new OpenAI({
      // Gemini expose une API compatible OpenAI : même code, autre adresse.
      apiKey: isGemini ? GEMINI_KEY : OPENAI_KEY,
      baseURL: isGemini ? `${GEMINI_BASE}/openai/` : undefined,
      timeout: 90_000,
      maxRetries: 0, // les retries sont gérés par withRetry() ci-dessous
    });
  }
  return client;
}

export const MODELS = isGemini
  ? {
      main: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
      fallback: process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite',
      embed: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2',
    }
  : {
      main: process.env.OPENAI_MODEL || 'gpt-4o',
      fallback: process.env.OPENAI_FALLBACK_MODEL || 'gpt-4o-mini',
      embed: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    };

/* Gemini réfléchit avant de répondre et ces « pensées » consomment des tokens :
   effort réduit + marge sur max_tokens, sinon les réponses sont coupées. */
export const chatExtras: { reasoning_effort?: 'low' } = isGemini ? { reasoning_effort: 'low' } : {};
export function tokenLimit(n: number): number {
  return isGemini ? n * 2 : n;
}

/* Prix indicatifs en USD par million de tokens (à ajuster selon la grille OpenAI en vigueur). */
const PRICES: Record<string, { in: number; out: number }> = {
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'text-embedding-3-small': { in: 0.02, out: 0 },
};

export async function trackUsage(
  userId: string | null,
  route: string,
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined | null,
) {
  if (!userId || !usage) return;
  const p = model.startsWith('gemini') ? { in: 0, out: 0 } : PRICES[model] || PRICES['gpt-4o'];
  const pt = usage.prompt_tokens || 0;
  const ct = usage.completion_tokens || 0;
  const { error } = await admin().from('ai_usage').insert({
    user_id: userId,
    route,
    model,
    prompt_tokens: pt,
    completion_tokens: ct,
    total_tokens: usage.total_tokens || pt + ct,
    cost_usd: (pt * p.in + ct * p.out) / 1_000_000,
  });
  if (error) console.warn('[ai] suivi des tokens impossible', error.message);
}

function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status && [408, 409, 429, 500, 502, 503, 504].includes(status)) return true;
  const name = (err as Error)?.name || '';
  return /timeout|abort|ECONNRESET|ETIMEDOUT|fetch failed/i.test(name + ' ' + (err as Error)?.message);
}

/** Retry exponentiel avec gigue : 0,8 s → 1,6 s → 3,2 s. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, retries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryable(err)) break;
      const wait = 800 * 2 ** attempt + Math.random() * 300;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  const status = (err as { status?: number })?.status;
  const detail = (err as Error)?.message || '';
  if (/api.?key|permission.?denied/i.test(detail) || status === 401 || status === 403) {
    return new HttpError(503, 'ai_bad_key', "La clé d'API IA est refusée. Vérifie la valeur dans .env.local.");
  }
  if (status === 404) return new HttpError(503, 'ai_bad_model', "Le modèle d'IA demandé n'existe plus. Change GEMINI_MODEL dans .env.local.");
  if (status === 429) return new HttpError(503, 'ai_busy', "Le quota de l'IA est atteint pour le moment. Réessaie dans une minute.");
  if (status === 400) return new HttpError(422, 'ai_rejected', "L'IA n'a pas pu traiter ce contenu (trop long ou format inattendu).");
  return new HttpError(502, 'ai_unavailable', "L'IA ne répond pas pour le moment. Réessaie dans quelques instants.");
}

interface JsonGenOptions<T> {
  userId: string | null;
  route: string;
  system: string;
  prompt: string;
  schema: ZodType<T, ZodTypeDef, unknown>;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Génère un objet JSON validé par zod.
 * 1) modèle principal (retry ×2) → 2) si JSON invalide : nouvelle tentative avec
 * le message d'erreur → 3) si l'API échoue : modèle de repli.
 */
export async function generateJSON<T>(o: JsonGenOptions<T>): Promise<T> {
  const attemptWith = async (model: string): Promise<T> => {
    let feedback = '';
    for (let pass = 0; pass < 2; pass++) {
      const completion = await withRetry(() =>
        openai().chat.completions.create({
          model,
          temperature: o.temperature ?? 0.4,
          max_tokens: tokenLimit(o.maxTokens ?? 4000),
          ...chatExtras,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: o.system },
            { role: 'user', content: o.prompt + feedback },
          ],
        }),
      );
      await trackUsage(o.userId, o.route, model, completion.usage);
      const raw = (completion.choices[0]?.message?.content || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        feedback = '\n\nATTENTION : ta réponse précédente n\'était pas du JSON valide. Réponds UNIQUEMENT avec un objet JSON.';
        continue;
      }
      const parsed = o.schema.safeParse(json);
      if (parsed.success) return parsed.data;
      feedback = `\n\nATTENTION : ta réponse précédente ne respectait pas le format (${parsed.error.issues
        .slice(0, 3)
        .map((i) => i.path.join('.') + ' : ' + i.message)
        .join(' ; ')}). Corrige et renvoie l'objet JSON complet.`;
    }
    throw new HttpError(502, 'ai_bad_output', "L'IA a produit un résultat inexploitable. Réessaie, ou raccourcis le texte source.");
  };

  try {
    return await attemptWith(MODELS.main);
  } catch (err) {
    if (err instanceof HttpError && err.code !== 'ai_bad_output') throw err;
    if (MODELS.fallback && MODELS.fallback !== MODELS.main) {
      try {
        return await attemptWith(MODELS.fallback);
      } catch (err2) {
        throw toHttpError(err2);
      }
    }
    throw toHttpError(err);
  }
}

/** Gemini : API native, seule à documenter la taille des vecteurs (1536 = colonne vector(1536)). */
async function geminiEmbed(batch: string[]): Promise<number[][]> {
  const model = `models/${MODELS.embed}`;
  const res = await fetch(`${GEMINI_BASE}/${model}:batchEmbedContents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY as string },
    body: JSON.stringify({ requests: batch.map((text) => ({ model, content: { parts: [{ text }] }, outputDimensionality: 1536 })) }),
  });
  if (!res.ok) throw Object.assign(new Error(`Gemini embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`), { status: res.status });
  const json = (await res.json()) as { embeddings: { values: number[] }[] };
  return json.embeddings.map((e) => e.values);
}

/** Embeddings par lots de 96 textes. */
export async function embed(texts: string[], userId: string | null, route = 'embed'): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 96) {
    const batch = texts.slice(i, i + 96).map((t) => t.slice(0, 8000));
    if (isGemini) {
      out.push(...(await withRetry(() => geminiEmbed(batch))));
      continue;
    }
    const res = await withRetry(() => openai().embeddings.create({ model: MODELS.embed, input: batch }));
    await trackUsage(userId, route, MODELS.embed, { prompt_tokens: res.usage?.prompt_tokens, total_tokens: res.usage?.total_tokens });
    out.push(...res.data.map((d) => d.embedding));
  }
  return out;
}

/** OCR d'une image (notes manuscrites, photo de tableau) via le modèle vision. */
export async function ocrImage(buffer: Buffer, mime: string, userId: string | null): Promise<string> {
  try {
    const completion = await withRetry(() =>
      openai().chat.completions.create({
        model: MODELS.main,
        temperature: 0,
        max_tokens: tokenLimit(4000),
        ...chatExtras,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  "Transcris fidèlement TOUT le texte visible sur cette image (notes de cours, tableau, polycopié). " +
                  'Conserve la structure (titres, listes, formules en notation lisible). ' +
                  "N'ajoute aucun commentaire. Si l'image ne contient pas de texte, réponds exactement : [AUCUN TEXTE]",
              },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${buffer.toString('base64')}`, ...(isGemini ? {} : { detail: 'high' as const }) } },
            ],
          },
        ],
      }),
    );
    await trackUsage(userId, 'ocr', MODELS.main, completion.usage);
    const text = completion.choices[0]?.message?.content?.trim() || '';
    return text === '[AUCUN TEXTE]' ? '' : text;
  } catch (err) {
    throw toHttpError(err);
  }
}

export { toHttpError };
