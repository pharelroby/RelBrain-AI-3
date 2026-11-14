/* GET /api/cron/subscriptions — quotidien (vercel.json).
   · J-3 : rappel de renouvellement (in-app + email)
   · Échéance passée : retour au plan gratuit (les données sont conservées) */
import { route, HttpError, bearer } from '../../lib/http';
import { admin } from '../../lib/supabase';
import { appUrl } from '../../lib/env';
import { sendEmail, emailLayout } from '../../lib/notify';

export default route({ methods: ['GET', 'POST'] }, async ({ req }) => {
  if (!process.env.CRON_SECRET || bearer(req) !== process.env.CRON_SECRET) {
    throw new HttpError(401, 'unauthorized', 'Accès réservé aux tâches planifiées.');
  }
  const sb = admin();
  const now = new Date();
  const in3days = new Date(now.getTime() + 3 * 86400_000);
  const in2days = new Date(now.getTime() + 2 * 86400_000);

  // Rappels J-3 (fenêtre de 24 h pour n'envoyer qu'une fois)
  const { data: soon } = await sb
    .from('subscriptions')
    .select('user_id, plan, current_period_end')
    .neq('plan', 'free')
    .eq('status', 'active')
    .gte('current_period_end', in2days.toISOString())
    .lt('current_period_end', in3days.toISOString());
  for (const s of soon || []) {
    const end = new Date(s.current_period_end).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    await sb.rpc('notify', {
      p_user: s.user_id,
      p_category: 'payment',
      p_title: `Ton accès ${s.plan === 'pro' ? 'Pro' : 'Premium'} se termine le ${end}`,
      p_body: 'Renouvelle en 1 minute par Orange Money, MTN MoMo ou carte pour garder tes avantages.',
      p_icon: '⏳',
      p_link: 'relbrain-parametres.html#abonnement',
      p_data: {},
    });
    const { data: u } = await sb.auth.admin.getUserById(s.user_id);
    if (u?.user?.email) {
      await sendEmail({
        to: u.user.email,
        subject: `Ton accès RelBrain se termine le ${end}`,
        html: emailLayout({
          title: `Ton accès ${s.plan === 'pro' ? 'Pro' : 'Premium'} se termine le ${end}`,
          intro: 'Renouvelle en une minute pour garder tes quiz illimités, le mode examen et l\'IA adaptative. Tes documents et ta progression sont conservés quoi qu\'il arrive.',
          cta: { label: 'Renouveler mon accès', url: `${appUrl()}/relbrain-parametres.html#abonnement` },
        }),
      });
    }
  }

  // Expirations
  const { data: expired } = await sb
    .from('subscriptions')
    .update({ plan: 'free', status: 'active', current_period_end: null })
    .neq('plan', 'free')
    .lt('current_period_end', now.toISOString())
    .select('user_id');
  for (const s of expired || []) {
    await sb.rpc('notify', {
      p_user: s.user_id,
      p_category: 'payment',
      p_title: 'Ton compte est repassé en Gratuit',
      p_body: 'Tes documents, quiz et ta progression sont intacts. Tu peux réactiver Pro à tout moment.',
      p_icon: 'ℹ️',
      p_link: 'relbrain-parametres.html#abonnement',
      p_data: {},
    });
  }

  return { reminded: soon?.length || 0, expired: expired?.length || 0 };
});
