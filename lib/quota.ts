/* Quotas par plan (Free / Pro / Premium) : documents/mois, quiz/mois,
   requêtes IA/jour, nombre max de questions, taille max des fichiers.
   Les limites vivent dans la table « plans » (migration 0004).          */
import { HttpError } from './http';
import { admin } from './supabase';
import { hit } from './rate-limit';

export interface Quota {
  plan: 'free' | 'pro' | 'premium';
  documents: { limit: number | null; used: number };
  quizzes: { limit: number | null; used: number };
  ai_requests: { limit: number | null; used: number };
  max_questions: number;
  max_file_mb: number;
  features: Record<string, unknown>;
}

export async function getQuota(userId: string): Promise<Quota> {
  const { data, error } = await admin().rpc('quota_status', { p_user: userId });
  if (error || !data) throw new HttpError(500, 'quota_unavailable', 'Impossible de vérifier ton forfait pour le moment.');
  return data as Quota;
}

const LABELS: Record<string, string> = {
  documents: 'documents ce mois-ci',
  quizzes: 'quiz ce mois-ci',
  ai_requests: 'requêtes IA aujourd\'hui',
};

export async function assertQuota(userId: string, kind: 'documents' | 'quizzes' | 'ai_requests'): Promise<Quota> {
  const q = await getQuota(userId);
  const { limit, used } = q[kind];
  if (limit !== null && used >= limit) {
    throw new HttpError(
      402,
      'quota_exceeded',
      `Tu as atteint la limite de ton forfait ${q.plan === 'free' ? 'Gratuit' : q.plan} (${limit} ${LABELS[kind]}). Passe à Pro pour continuer sans limite.`,
      { kind, limit, used, plan: q.plan },
    );
  }
  return q;
}

/** Limite de rafale IA par minute, selon le plan. */
export async function assertAiBurst(userId: string, plan: Quota['plan']) {
  const perMinute = plan === 'free' ? 6 : plan === 'pro' ? 20 : 40;
  if (!(await hit(`ai:${userId}`, perMinute, 60))) {
    throw new HttpError(429, 'rate_limited', 'Doucement 🙂 Trop de requêtes IA en une minute. Réessaie dans un instant.');
  }
}

export function hasFeature(q: Quota, feature: string): boolean {
  return q.features?.[feature] === true;
}
