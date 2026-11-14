/* POST /api/webhooks/mobile-money?provider=mtn|orange
   · MTN : le callback n'est pas signé → on ne lui fait PAS confiance : on
     relit le statut directement auprès de l'API MTN avant d'activer.
   · Orange : la notification contient notif_token, comparé à celui reçu
     lors de l'initialisation (stocké dans payments.raw).                  */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendError, HttpError } from '../../lib/http';
import { admin } from '../../lib/supabase';
import { activatePayment, failPayment, getProvider } from '../../lib/payments';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST' && req.method !== 'PUT') throw new HttpError(405, 'method_not_allowed', 'POST uniquement.');
    const provider = String(req.query.provider || '');
    const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) || {};
    const sb = admin();

    if (provider === 'mtn') {
      const ref = String(body.referenceId || body.financialTransactionId || req.headers['x-reference-id'] || '');
      const externalId = String(body.externalId || '');
      let query = sb.from('payments').select('*').eq('provider', 'mtn_momo').eq('status', 'pending');
      query = ref ? query.eq('provider_ref', ref) : query.eq('id', externalId);
      const { data: pay } = await query.maybeSingle();
      if (pay) {
        const status = await (await getProvider('mtn_momo')).fetchStatus!(pay.provider_ref, { amount: pay.amount, raw: pay.raw });
        if (status === 'succeeded') await activatePayment(pay.id, { callback: body });
        else if (status === 'failed') await failPayment(pay.id, { callback: body });
      }
    } else if (provider === 'orange') {
      const paymentId = String(req.query.payment || '');
      const { data: pay } = await sb.from('payments').select('*').eq('id', paymentId).eq('provider', 'orange_money').maybeSingle();
      const expected = (pay?.raw as { notif_token?: string } | null)?.notif_token;
      if (!pay || !expected || body.notif_token !== expected) throw new HttpError(401, 'invalid_token', 'Notification non authentifiée.');
      if (body.status === 'SUCCESS') await activatePayment(pay.id, { ...(pay.raw as object), txnid: body.txnid });
      else if (body.status === 'FAILED' || body.status === 'EXPIRED') await failPayment(pay.id, { ...(pay.raw as object), callback: body });
    } else {
      throw new HttpError(400, 'unknown_provider', 'Prestataire inconnu.');
    }
    res.status(200).json({ received: true });
  } catch (err) {
    sendError(res, err);
  }
}
