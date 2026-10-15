/* ═══════════════════════════════════════════════════════════════════════════
   PAIEMENTS — architecture commune à tous les moyens de paiement.

   Modèle : achat d'une PÉRIODE d'accès (1 mois ou 12 mois), sans
   renouvellement automatique. C'est le modèle le plus adapté au Mobile
   Money (pas de prélèvement récurrent) et il reste simple avec Stripe.
   Un rappel est envoyé 3 jours avant l'expiration (/api/cron/subscriptions).

   Flux :
   1. POST /api/payments/checkout   → crée une ligne « payments » (pending)
                                      et démarre le paiement chez le prestataire
   2. Le prestataire confirme       → webhook /api/webhooks/{stripe|mobile-money}
      (ou l'app interroge           → GET /api/payments/status?id=…)
   3. activatePayment()             → abonnement prolongé, notification envoyée
   ═══════════════════════════════════════════════════════════════════════════ */
import { admin } from '../supabase';
import { HttpError } from '../http';

export type Provider = 'stripe' | 'orange_money' | 'mtn_momo';
export type Plan = 'pro' | 'premium';

export interface CheckoutInput {
  paymentId: string;
  userId: string;
  email: string;
  plan: Plan;
  months: 1 | 12;
  amount: number;          // unité minimale de la devise (centimes EUR, ou XAF)
  currency: 'EUR' | 'XAF';
  phone?: string;          // Mobile Money : numéro au format international (2376XXXXXXXX)
}

export interface CheckoutResult {
  status: 'pending' | 'succeeded' | 'failed';
  provider_ref: string;
  /** Redirection navigateur (Stripe Checkout, Orange Money WebPay). */
  redirect_url?: string;
  /** Message à afficher (MTN : « Valide le paiement sur ton téléphone »). */
  instructions?: string;
  /** Données internes conservées dans payments.raw (jetons de vérification…). */
  meta?: Record<string, unknown>;
}

export interface PaymentProvider {
  id: Provider;
  currency: 'EUR' | 'XAF';
  checkout(input: CheckoutInput): Promise<CheckoutResult>;
  /** Interroge le prestataire (paiements asynchrones). */
  fetchStatus?(providerRef: string, payment: { amount: number; raw: Record<string, unknown> | null }): Promise<'pending' | 'succeeded' | 'failed'>;
}

/** Prix : 12 mois = 10 mois payés (2 mois offerts). */
export async function priceFor(plan: Plan, months: 1 | 12, currency: 'EUR' | 'XAF'): Promise<number> {
  const { data } = await admin().from('plans').select('price_eur_cents, price_xaf').eq('id', plan).single();
  if (!data) throw new HttpError(400, 'unknown_plan', 'Forfait inconnu.');
  const monthly = currency === 'EUR' ? data.price_eur_cents : data.price_xaf;
  return months === 12 ? monthly * 10 : monthly;
}

export async function getProvider(id: Provider): Promise<PaymentProvider> {
  switch (id) {
    case 'stripe':
      return (await import('./stripe')).stripeProvider;
    case 'mtn_momo':
      return (await import('./mtn-momo')).mtnProvider;
    case 'orange_money':
      return (await import('./orange-money')).orangeProvider;
    default:
      throw new HttpError(400, 'unknown_provider', 'Moyen de paiement inconnu.');
  }
}

/**
 * Valide un paiement et prolonge l'abonnement. Idempotent : un paiement déjà
 * « succeeded » n'est jamais appliqué deux fois.
 */
export async function activatePayment(paymentId: string, raw?: unknown): Promise<boolean> {
  const sb = admin();
  const { data: pay } = await sb.from('payments').select('*').eq('id', paymentId).maybeSingle();
  if (!pay) return false;
  if (pay.status === 'succeeded') return true;

  const { data: updated } = await sb
    .from('payments')
    .update({ status: 'succeeded', raw: raw ?? pay.raw })
    .eq('id', paymentId)
    .neq('status', 'succeeded')
    .select('id')
    .maybeSingle();
  if (!updated) return true; // traité en parallèle par un autre appel

  const { data: sub } = await sb.from('subscriptions').select('*').eq('user_id', pay.user_id).maybeSingle();
  const now = new Date();
  const base = sub?.current_period_end && new Date(sub.current_period_end) > now && sub.plan === pay.plan ? new Date(sub.current_period_end) : now;
  const end = new Date(base);
  end.setMonth(end.getMonth() + pay.period_months);

  await sb.from('subscriptions').upsert(
    {
      user_id: pay.user_id,
      plan: pay.plan,
      status: 'active',
      provider: pay.provider,
      current_period_start: now.toISOString(),
      current_period_end: end.toISOString(),
      cancel_at_period_end: true,
    },
    { onConflict: 'user_id' },
  );
  await sb.rpc('notify', {
    p_user: pay.user_id,
    p_category: 'payment',
    p_title: `Bienvenue dans RelBrain ${pay.plan === 'pro' ? 'Pro' : 'Premium'} 🎉`,
    p_body: `Ton accès est actif jusqu'au ${end.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}.`,
    p_icon: '💎',
    p_link: 'relbrain-parametres.html#abonnement',
    p_data: { payment_id: paymentId },
  });
  await sb.rpc('check_achievements', { p_user: pay.user_id });
  return true;
}

export async function failPayment(paymentId: string, raw?: unknown) {
  await admin().from('payments').update({ status: 'failed', raw: raw ?? null }).eq('id', paymentId).eq('status', 'pending');
}
