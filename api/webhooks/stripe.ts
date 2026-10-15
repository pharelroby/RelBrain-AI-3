/* POST /api/webhooks/stripe — événements Stripe signés (STRIPE_WEBHOOK_SECRET). */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type Stripe from 'stripe';
import { rawBody, sendError, HttpError } from '../../lib/http';
import { stripe } from '../../lib/payments/stripe';
import { activatePayment, failPayment } from '../../lib/payments';

// Corps brut indispensable à la vérification de signature
export const config = { api: { bodyParser: false } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'POST uniquement.');
    const secret = process.env.STRIPE_WEBHOOK_SECRET; // ⬅️ 🔑 whsec_… (voir lib/payments/stripe.ts)
    if (!secret) throw new HttpError(503, 'config_missing', 'STRIPE_WEBHOOK_SECRET manquant.');
    const sig = req.headers['stripe-signature'] as string | undefined;
    if (!sig) throw new HttpError(400, 'missing_signature', 'Signature absente.');

    let event: Stripe.Event;
    try {
      event = stripe().webhooks.constructEvent(await rawBody(req), sig, secret);
    } catch {
      throw new HttpError(400, 'invalid_signature', 'Signature Stripe invalide.');
    }

    const session = event.data.object as Stripe.Checkout.Session;
    const paymentId = session?.metadata?.payment_id;
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        if (paymentId && session.payment_status === 'paid') await activatePayment(paymentId, { stripe_session: session.id, event: event.id });
        break;
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        if (paymentId) await failPayment(paymentId, { stripe_session: session.id, event: event.id });
        break;
      default:
        break; // événement ignoré
    }
    res.status(200).json({ received: true });
  } catch (err) {
    sendError(res, err);
  }
}
