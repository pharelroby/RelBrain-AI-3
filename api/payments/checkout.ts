/* POST /api/payments/checkout { plan, months, provider, phone? }
   Crée le paiement (pending) puis le démarre chez le prestataire choisi.
   Réponse : { payment_id, status, redirect_url?, instructions? }          */
import { z } from 'zod';
import { route, parse, HttpError } from '../../lib/http';
import { admin } from '../../lib/supabase';
import { getProvider, priceFor } from '../../lib/payments';

const Body = z.object({
  plan: z.enum(['pro', 'premium']),
  months: z.union([z.literal(1), z.literal(12)]).default(1),
  provider: z.enum(['stripe', 'orange_money', 'mtn_momo']),
  phone: z
    .string()
    .transform((s) => s.replace(/[\s+().-]/g, ''))
    .optional(),
});

export default route(
  { methods: ['POST'], auth: true, rateLimit: { key: (c) => `checkout:${c.user!.id}`, max: 10, windowSec: 3600 } },
  async ({ req, user }) => {
    const body = parse(Body, req.body);
    const provider = await getProvider(body.provider);
    const amount = await priceFor(body.plan, body.months, provider.currency);
    // Numéros camerounais saisis sans indicatif : on ajoute 237
    const phone = body.phone && /^6\d{8}$/.test(body.phone) ? `237${body.phone}` : body.phone;

    const sb = admin();
    const { data: payment, error } = await sb
      .from('payments')
      .insert({
        user_id: user.id,
        provider: body.provider,
        provider_ref: `init_${crypto.randomUUID()}`,
        plan: body.plan,
        period_months: body.months,
        amount,
        currency: provider.currency,
        status: 'pending',
        phone: phone || null,
      })
      .select('id')
      .single();
    if (error || !payment) throw new HttpError(500, 'payment_init_failed', "Le paiement n'a pas pu être initialisé.");

    try {
      const result = await provider.checkout({
        paymentId: payment.id,
        userId: user.id,
        email: user.email || '',
        plan: body.plan,
        months: body.months,
        amount,
        currency: provider.currency,
        phone,
      });
      await sb.from('payments').update({ provider_ref: result.provider_ref, raw: result.meta || null }).eq('id', payment.id);
      return {
        payment_id: payment.id,
        status: result.status,
        redirect_url: result.redirect_url,
        instructions: result.instructions,
        amount,
        currency: provider.currency,
      };
    } catch (err) {
      await sb.from('payments').update({ status: 'failed' }).eq('id', payment.id);
      throw err;
    }
  },
);
