/* GET /api/cron/notifications — exécuté une fois par jour à 17 h UTC, soit 18 h au
   Cameroun (vercel.json → crons ; le plan gratuit de Vercel n'autorise pas plus).
   Bonus : cet appel quotidien à la base empêche Supabase de mettre le projet en pause.
   1. Rappels intelligents : élèves qui n'ont pas encore étudié aujourd'hui,
      à leur heure habituelle (apprise) ou choisie, hors heures calmes.
   2. Livraison push / email des notifications in-app récentes non envoyées.
   Protégé par CRON_SECRET (Vercel envoie « Authorization: Bearer … »).    */
import { route, HttpError, bearer } from '../../lib/http';
import { admin } from '../../lib/supabase';
import { appUrl } from '../../lib/env';
import { sendPush, sendEmail, emailLayout, escapeHtml } from '../../lib/notify';

// ═══════════════════════════════════════════════════════════════
// 🔑 SECRET DES TÂCHES PLANIFIÉES À INSÉRER ICI
// ────────────────────────────────────────────────────────────────
// 1. Génère une valeur aléatoire : openssl rand -hex 32
// 2. Ajoute dans .env.local ET dans Vercel → Environment Variables :
//    CRON_SECRET=xxxxxxxx...
// Vercel l'envoie automatiquement aux routes déclarées dans
// vercel.json → crons.
// ═══════════════════════════════════════════════════════════════
function assertCron(token: string | null) {
  const secret = process.env.CRON_SECRET; // ⬅️ LE SECRET EST ICI
  if (!secret || token !== secret) throw new HttpError(401, 'unauthorized', 'Accès réservé aux tâches planifiées.');
}

interface DueUser {
  user_id: string;
  email: string;
  first_name: string | null;
  streak: number;
  due_cards: number;
  push: boolean;
  mail: boolean;
}

function reminderCopy(u: DueUser) {
  if (u.streak >= 2) {
    return {
      title: `🔥 Ta série de ${u.streak} jours t'attend`,
      body: u.due_cards ? `${u.due_cards} cartes sont prêtes à être révisées. 5 minutes suffisent.` : 'Un quiz express de 5 minutes suffit pour la prolonger.',
      link: u.due_cards ? 'relbrain-flashcards.html' : 'relbrain-quiz-setup.html',
    };
  }
  if (u.due_cards) {
    return { title: `🧠 ${u.due_cards} cartes à réviser`, body: "C'est le bon moment pour les ancrer dans ta mémoire.", link: 'relbrain-flashcards.html' };
  }
  return { title: '📚 On révise un peu ?', body: 'Quelques minutes par jour valent mieux qu\'une nuit blanche avant l\'examen.', link: 'relbrain-accueil.html' };
}

export default route({ methods: ['GET', 'POST'] }, async ({ req }) => {
  assertCron(bearer(req));
  const sb = admin();
  let reminders = 0;
  let pushed = 0;
  let emailed = 0;

  // 1. Rappels du moment
  // REMINDERS_HOURLY=true (plan Vercel payant + cron horaire) : chaque élève reçoit
  // son rappel à son heure. Sinon : un seul passage par jour, pour tout le monde.
  const hourly = process.env.REMINDERS_HOURLY === 'true';
  const { data: due, error } = await sb.rpc('users_due_for_reminder', { p_any_hour: !hourly });
  if (error) throw new HttpError(500, 'cron_failed', error.message);
  for (const u of (due || []) as DueUser[]) {
    const copy = reminderCopy(u);
    const { data: notifId } = await sb.rpc('notify', {
      p_user: u.user_id,
      p_category: 'reminder',
      p_title: copy.title,
      p_body: copy.body,
      p_icon: '⏰',
      p_link: copy.link,
      p_data: {},
    });
    if (!notifId) continue;
    reminders++;
    let pushCount = 0;
    if (u.push) pushCount = await sendPush(u.user_id, { title: copy.title, body: copy.body, url: copy.link, tag: 'daily-reminder' });
    // Email seulement si aucun appareil n'a reçu de push
    if (!pushCount && u.mail && u.email) {
      const ok = await sendEmail({
        to: u.email,
        subject: copy.title.replace(/^[^\p{L}]+/u, ''),
        html: emailLayout({
          title: `${u.first_name ? escapeHtml(u.first_name) + ', ' : ''}${escapeHtml(copy.title.replace(/^[^\p{L}]+/u, ''))}`,
          intro: escapeHtml(copy.body),
          cta: { label: 'Réviser maintenant', url: `${appUrl()}/${copy.link}` },
        }),
      });
      if (ok) emailed++;
    }
    await sb.from('notifications').update({ push_sent_at: new Date().toISOString(), email_sent_at: pushCount ? null : new Date().toISOString() }).eq('id', notifId);
    pushed += pushCount;
  }

  // 2. Notifications récentes (badges, ligues, défis, paiements…) pas encore poussées
  const since = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const { data: pending } = await sb
    .from('notifications')
    .select('id, user_id, title, body, link, category')
    .is('push_sent_at', null)
    .is('read_at', null)
    .neq('category', 'reminder')
    .gte('created_at', since)
    .limit(500);
  for (const n of pending || []) {
    const { data: pref } = await sb.from('notification_preferences').select('channel_push').eq('user_id', n.user_id).maybeSingle();
    if (pref?.channel_push !== false) pushed += await sendPush(n.user_id, { title: n.title, body: n.body || undefined, url: n.link || undefined, tag: n.category });
    await sb.from('notifications').update({ push_sent_at: new Date().toISOString() }).eq('id', n.id);
  }

  return { reminders, pushed, emailed, delivered: pending?.length || 0 };
});
