/* ═══════════════════════════════════════════════════════════════════════════
   Orange Money — API « Web Payment » (Orange Developer).
   Docs : https://developer.orange.com/apis/om-webpay
   Flux : redirection vers la page de paiement Orange → l'utilisateur valide
   → Orange appelle notif_url (vérifiée avec notif_token) → retour sur le site.
   ⚠️ Les URL exactes (code pays, environnement « dev ») et la devise de test
   dépendent de ton contrat marchand : vérifie-les dans ton espace Orange
   Developer avant la mise en production.
   ═══════════════════════════════════════════════════════════════════════════ */
import { env, appUrl } from '../env';
import { HttpError } from '../http';
import type { PaymentProvider } from './index';

// ═══════════════════════════════════════════════════════════════
// 🔑 CLÉS ORANGE MONEY À INSÉRER ICI
// ────────────────────────────────────────────────────────────────
// 1. Crée une application sur https://developer.orange.com/myapps
// 2. Abonne-la à l'API « Orange Money Web Payment » (Cameroun)
// 3. Récupère l'« Authorization header » (client_id:client_secret
//    encodés en Base64) et ta « merchant key » (contrat marchand)
// 4. Ajoute dans ton fichier .env.local :
//    ORANGE_MONEY_AUTH_HEADER=Basic xxxxxxxxxxxxxxxx
//    ORANGE_MONEY_MERCHANT_KEY=xxxxxxxx
//    ORANGE_MONEY_API_URL=https://api.orange.com/orange-money-webpay/dev/v1
//                         (prod : …/orange-money-webpay/cm/v1)
//    ORANGE_MONEY_CURRENCY=OUV           (prod : XAF)
// 5. Redémarre le serveur : npm run dev
// ═══════════════════════════════════════════════════════════════
let token: { value: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  if (token && token.exp > Date.now() + 30_000) return token.value;
  const res = await fetch('https://api.orange.com/oauth/v3/token', {
    method: 'POST',
    headers: {
      Authorization: env('ORANGE_MONEY_AUTH_HEADER'), // ⬅️ LA CLÉ EST ICI
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new HttpError(502, 'orange_auth_failed', 'Orange Money est indisponible pour le moment.');
  const json = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: json.access_token, exp: Date.now() + Number(json.expires_in) * 1000 };
  return token.value;
}

const api = () => env('ORANGE_MONEY_API_URL').replace(/\/+$/, '');

export const orangeProvider: PaymentProvider = {
  id: 'orange_money',
  currency: 'XAF',
  async checkout(input) {
    const orderId = input.paymentId.replace(/-/g, '').slice(0, 30);
    const res = await fetch(`${api()}/webpayment`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        merchant_key: env('ORANGE_MONEY_MERCHANT_KEY'), // ⬅️ CLÉ MARCHAND ICI
        currency: process.env.ORANGE_MONEY_CURRENCY || 'XAF',
        order_id: orderId,
        amount: input.amount,
        return_url: `${appUrl()}/relbrain-parametres.html?payment=${input.paymentId}#abonnement`,
        cancel_url: `${appUrl()}/relbrain-parametres.html?payment=cancelled#abonnement`,
        notif_url: `${appUrl()}/api/webhooks/mobile-money?provider=orange&payment=${input.paymentId}`,
        lang: 'fr',
        reference: 'RelBrain',
      }),
    });
    if (!res.ok) throw new HttpError(502, 'orange_request_failed', "Le paiement Orange Money n'a pas pu être initialisé.");
    const json = (await res.json()) as { payment_url: string; pay_token: string; notif_token: string };
    return {
      status: 'pending',
      provider_ref: json.pay_token,
      redirect_url: json.payment_url,
      // notif_token est conservé dans payments.raw pour authentifier le webhook
      meta: { notif_token: json.notif_token, order_id: orderId },
    };
  },
  async fetchStatus(ref, payment) {
    const res = await fetch(`${api()}/transactionstatus`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ order_id: payment.raw?.order_id, amount: payment.amount, pay_token: ref }),
    });
    if (!res.ok) return 'pending';
    const json = (await res.json()) as { status?: string };
    if (json.status === 'SUCCESS') return 'succeeded';
    if (json.status === 'FAILED' || json.status === 'EXPIRED') return 'failed';
    return 'pending';
  },
};
