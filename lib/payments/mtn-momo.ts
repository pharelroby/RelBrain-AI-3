/* ═══════════════════════════════════════════════════════════════════════════
   MTN Mobile Money — API « Collection » (Request to Pay).
   Docs : https://momodeveloper.mtn.com/api-documentation
   Flux : l'utilisateur saisit son numéro → il reçoit une demande de
   validation sur son téléphone (code PIN) → MTN appelle notre callback,
   et l'app interroge aussi /api/payments/status en attendant.
   ═══════════════════════════════════════════════════════════════════════════ */
import { randomUUID } from 'crypto';
import { env, appUrl } from '../env';
import { HttpError } from '../http';
import type { PaymentProvider } from './index';

// ═══════════════════════════════════════════════════════════════
// 🔑 CLÉS MTN MOBILE MONEY À INSÉRER ICI
// ────────────────────────────────────────────────────────────────
// 1. Crée un compte sur https://momodeveloper.mtn.com
// 2. Abonne-toi au produit « Collection » → copie la
//    « Primary key » (Ocp-Apim-Subscription-Key)
// 3. Crée un API User + API Key (sandbox : via l'API « provisioning »,
//    production : fournis par MTN Cameroun après signature du contrat)
// 4. Ajoute dans ton fichier .env.local :
//    MTN_MOMO_BASE_URL=https://sandbox.momodeveloper.mtn.com
//                      (prod : https://proxy.momoapi.mtn.com)
//    MTN_MOMO_TARGET_ENV=sandbox            (prod : mtncameroon)
//    MTN_MOMO_SUBSCRIPTION_KEY=xxxxxxxx
//    MTN_MOMO_API_USER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
//    MTN_MOMO_API_KEY=xxxxxxxx
// 5. Redémarre le serveur : npm run dev
// ⚠️ En sandbox, la devise acceptée est « EUR » : le code la
//    substitue automatiquement quand MTN_MOMO_TARGET_ENV=sandbox.
// ═══════════════════════════════════════════════════════════════
const base = () => env('MTN_MOMO_BASE_URL').replace(/\/+$/, '');
const targetEnv = () => env('MTN_MOMO_TARGET_ENV');

let token: { value: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  if (token && token.exp > Date.now() + 30_000) return token.value;
  const basic = Buffer.from(`${env('MTN_MOMO_API_USER')}:${env('MTN_MOMO_API_KEY')}`).toString('base64'); // ⬅️ CLÉS ICI
  const res = await fetch(`${base()}/collection/token/`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Ocp-Apim-Subscription-Key': env('MTN_MOMO_SUBSCRIPTION_KEY') },
  });
  if (!res.ok) throw new HttpError(502, 'momo_auth_failed', 'MTN Mobile Money est indisponible pour le moment.');
  const json = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: json.access_token, exp: Date.now() + json.expires_in * 1000 };
  return token.value;
}

export const mtnProvider: PaymentProvider = {
  id: 'mtn_momo',
  currency: 'XAF',
  async checkout(input) {
    if (!input.phone || !/^2376\d{8}$/.test(input.phone)) {
      throw new HttpError(400, 'invalid_phone', 'Numéro MTN invalide. Format attendu : 2376XXXXXXXX.');
    }
    const referenceId = randomUUID();
    const res = await fetch(`${base()}/collection/v1_0/requesttopay`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        'X-Reference-Id': referenceId,
        'X-Target-Environment': targetEnv(),
        'X-Callback-Url': `${appUrl()}/api/webhooks/mobile-money?provider=mtn`,
        'Ocp-Apim-Subscription-Key': env('MTN_MOMO_SUBSCRIPTION_KEY'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: String(input.amount),
        currency: targetEnv() === 'sandbox' ? 'EUR' : 'XAF',
        externalId: input.paymentId,
        payer: { partyIdType: 'MSISDN', partyId: input.phone },
        payerMessage: `RelBrain ${input.plan === 'pro' ? 'Pro' : 'Premium'} ${input.months} mois`,
        payeeNote: input.paymentId,
      }),
    });
    if (res.status !== 202) {
      throw new HttpError(502, 'momo_request_failed', "La demande de paiement MTN n'a pas pu être envoyée. Vérifie ton numéro et réessaie.");
    }
    return {
      status: 'pending',
      provider_ref: referenceId,
      instructions: 'Une demande de paiement a été envoyée sur ton téléphone. Compose ton code PIN MTN MoMo pour valider.',
    };
  },
  async fetchStatus(ref) {
    const res = await fetch(`${base()}/collection/v1_0/requesttopay/${ref}`, {
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        'X-Target-Environment': targetEnv(),
        'Ocp-Apim-Subscription-Key': env('MTN_MOMO_SUBSCRIPTION_KEY'),
      },
    });
    if (!res.ok) return 'pending';
    const json = (await res.json()) as { status?: string };
    if (json.status === 'SUCCESSFUL') return 'succeeded';
    if (json.status === 'FAILED' || json.status === 'REJECTED' || json.status === 'TIMEOUT') return 'failed';
    return 'pending';
  },
};
