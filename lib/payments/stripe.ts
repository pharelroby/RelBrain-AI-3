/* Stripe Checkout (cartes internationales) — paiement unique d'une période. */
import Stripe from 'stripe';
import { env, appUrl } from '../env';
import type { PaymentProvider } from './index';

// ═══════════════════════════════════════════════════════════════
// 🔑 CLÉS STRIPE À INSÉRER ICI
// ────────────────────────────────────────────────────────────────
// 1. Va sur https://dashboard.stripe.com/apikeys
// 2. Copie la clé secrète (sk_test_… en test, sk_live_… en prod)
// 3. Crée un endpoint webhook : https://dashboard.stripe.com/webhooks
//    URL : https://TON-DOMAINE/api/webhooks/stripe
//    Événements : checkout.session.completed,
//                 checkout.session.async_payment_succeeded,
//                 checkout.session.async_payment_failed,
//                 checkout.session.expired
// 4. Ajoute dans ton fichier .env.local :
//    STRIPE_SECRET_KEY=sk_test_xxxxx...
//    STRIPE_WEBHOOK_SECRET=whsec_xxxxx...
// 5. Redémarre le serveur : npm run dev
// ═══════════════════════════════════════════════════════════════
let client: Stripe | null = null;
export function stripe(): Stripe {
  if (!client) client = new Stripe(env('STRIPE_SECRET_KEY')); // ⬅️ LA CLÉ EST ICI
  return client;
}

export const stripeProvider: PaymentProvider = {
  id: 'stripe',
  currency: 'EUR',
  async checkout(input) {
    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      customer_email: input.email,
      client_reference_id: input.userId,
      locale: 'fr',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: input.amount,
            product_data: {
              name: `RelBrain ${input.plan === 'pro' ? 'Pro' : 'Premium'} — ${input.months === 12 ? '12 mois' : '1 mois'}`,
              description: input.months === 12 ? '2 mois offerts' : undefined,
            },
          },
        },
      ],
      metadata: { payment_id: input.paymentId, user_id: input.userId, plan: input.plan, months: String(input.months) },
      success_url: `${appUrl()}/relbrain-parametres.html?payment=${input.paymentId}#abonnement`,
      cancel_url: `${appUrl()}/relbrain-parametres.html?payment=cancelled#abonnement`,
    });
    return { status: 'pending', provider_ref: session.id, redirect_url: session.url || undefined };
  },
  async fetchStatus(ref) {
    const s = await stripe().checkout.sessions.retrieve(ref);
    if (s.payment_status === 'paid') return 'succeeded';
    if (s.status === 'expired') return 'failed';
    return 'pending';
  },
};
