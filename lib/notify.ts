/* ═══════════════════════════════════════════════════════════════════════════
   Livraison des notifications : Web Push (VAPID) et email (Resend).
   Les notifications in-app sont créées en base (fonction SQL notify()) ;
   ce module les « pousse » vers le téléphone et la boîte mail.
   ═══════════════════════════════════════════════════════════════════════════ */
import webpush from 'web-push';
import { admin } from './supabase';
import { appUrl } from './env';

// ═══════════════════════════════════════════════════════════════
// 🔑 CLÉS VAPID (NOTIFICATIONS PUSH) À INSÉRER ICI
// ────────────────────────────────────────────────────────────────
// 1. Génère une paire de clés : npm run vapid
//    (ou npx web-push generate-vapid-keys)
// 2. Ajoute dans ton fichier .env.local :
//    VAPID_PUBLIC_KEY=BEl6...        (publique : aussi dans relbrain-config.js)
//    VAPID_PRIVATE_KEY=Xk9...        (secrète : serveur uniquement)
//    VAPID_SUBJECT=mailto:support@relbrain.ai
// 3. Redémarre le serveur : npm run dev
// ═══════════════════════════════════════════════════════════════
let vapidReady = false;
function ensureVapid(): boolean {
  if (vapidReady) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY; // ⬅️ LA CLÉ PRIVÉE VAPID EST ICI
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@relbrain.ai', pub, priv);
  vapidReady = true;
  return true;
}

export interface PushPayload {
  title: string;
  body?: string;
  icon?: string;
  url?: string;
  tag?: string;
}

/** Envoie une notification push sur tous les appareils de l'utilisateur. */
export async function sendPush(userId: string, payload: PushPayload): Promise<number> {
  if (!ensureVapid()) return 0;
  const { data: subs } = await admin().from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', userId);
  let sent = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ ...payload, url: payload.url ? `${appUrl()}/${payload.url.replace(/^\//, '')}` : appUrl() }),
        { TTL: 60 * 60 * 12, urgency: 'normal' },
      );
      sent++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await admin().from('push_subscriptions').delete().eq('id', s.id); // abonnement expiré
      else console.warn('[push] échec', code, (err as Error).message);
    }
  }
  return sent;
}

// ═══════════════════════════════════════════════════════════════
// 🔑 CLÉ API EMAIL (RESEND) À INSÉRER ICI
// ────────────────────────────────────────────────────────────────
// 1. Va sur https://resend.com/api-keys et crée une clé
// 2. Vérifie ton domaine d'envoi sur https://resend.com/domains
// 3. Ajoute dans ton fichier .env.local :
//    RESEND_API_KEY=re_xxxxx...
//    EMAIL_FROM="RelBrain <bonjour@relbrain.ai>"
// 4. Redémarre le serveur : npm run dev
// (Les emails d'authentification — confirmation, mot de passe —
//  sont envoyés par Supabase Auth : configure le SMTP dans
//  Supabase → Authentication → Emails → SMTP Settings.)
// ═══════════════════════════════════════════════════════════════
export async function sendEmail(o: { to: string; subject: string; html: string; text?: string; replyTo?: string }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY; // ⬅️ LA CLÉ EST ICI
  if (!key) return false;
  const { Resend } = await import('resend');
  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || 'RelBrain <bonjour@relbrain.ai>',
    to: o.to,
    subject: o.subject,
    html: o.html,
    text: o.text,
    replyTo: o.replyTo,
  });
  if (error) {
    console.warn('[email] échec', error.message);
    return false;
  }
  return true;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Gabarit email aux couleurs RelBrain (tables + styles inline pour les clients mail). */
export function emailLayout(o: { title: string; intro: string; cta?: { label: string; url: string }; footer?: string }) {
  const cta = o.cta
    ? `<tr><td style="padding:8px 0 28px"><a href="${esc(o.cta.url)}" style="display:inline-block;background:#7c3aed;color:#ffffff;font-weight:700;text-decoration:none;padding:14px 26px;border-radius:999px;font-family:Arial,sans-serif;font-size:15px">${esc(o.cta.label)}</a></td></tr>`
    : '';
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#fdf4e8;padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #e7d9c5;border-radius:20px 20px 20px 6px;padding:32px" cellpadding="0" cellspacing="0">
<tr><td style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#1a1033;padding-bottom:4px">RelBrain<span style="color:#7c3aed;font-style:italic">.ai</span></td></tr>
<tr><td style="height:3px;background:#ec4899;width:48px;display:block;margin:10px 0 22px;border-radius:2px"></td></tr>
<tr><td style="font-family:Georgia,serif;font-size:24px;line-height:1.25;color:#1a1033;padding:6px 0 12px;font-weight:700">${esc(o.title)}</td></tr>
<tr><td style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#3f3651;padding-bottom:22px">${o.intro}</td></tr>
${cta}
<tr><td style="font-family:Arial,sans-serif;font-size:12px;line-height:1.5;color:#78716c;border-top:1px solid #f0e6d8;padding-top:16px">${o.footer || `Tu reçois cet email car tu as un compte RelBrain. <a href="${appUrl()}/relbrain-parametres.html#notifications" style="color:#7c3aed">Gérer mes notifications</a>.`}</td></tr>
</table></td></tr></table></body></html>`;
}

export { esc as escapeHtml };
