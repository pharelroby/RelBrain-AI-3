/* GET /api/payments/status?id=… — état d'un paiement (l'app interroge toutes
   les 3 s pendant que l'élève valide sur son téléphone). Si le paiement est
   encore « pending », on interroge le prestataire directement. */
import { z } from 'zod';
import { route, parse, HttpError } from '../../lib/http';
import { admin } from '../../lib/supabase';
import { activatePayment, failPayment, getProvider, type Provider } from '../../lib/payments';

export default route(
  { methods: ['GET'], auth: true, rateLimit: { key: (c) => `paystatus:${c.user!.id}`, max: 60, windowSec: 300 } },
  async ({ req, user }) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.query);
    const sb = admin();
    const { data: pay } = await sb.from('payments').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
    if (!pay) throw new HttpError(404, 'payment_not_found', 'Paiement introuvable.');

    let status = pay.status as string;
    if (status === 'pending' && !String(pay.provider_ref).startsWith('init_')) {
      const provider = await getProvider(pay.provider as Provider);
      if (provider.fetchStatus) {
        try {
          const s = await provider.fetchStatus(pay.provider_ref, { amount: pay.amount, raw: pay.raw });
          if (s === 'succeeded') { await activatePayment(pay.id); status = 'succeeded'; }
          else if (s === 'failed') { await failPayment(pay.id); status = 'failed'; }
        } catch (err) {
          console.warn('[payments] statut indisponible', (err as Error).message);
        }
      }
    }
    const { data: sub } = await sb.from('subscriptions').select('plan, status, current_period_end').eq('user_id', user.id).maybeSingle();
    return { status, plan: pay.plan, subscription: sub };
  },
);
