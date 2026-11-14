/* GET /api/account/export — droit d'accès et de portabilité (RGPD art. 15 & 20) :
   renvoie toutes les données de l'utilisateur au format JSON téléchargeable. */
import { route } from '../../lib/http';
import { asUser } from '../../lib/supabase';

const TABLES = [
  'profiles', 'subscriptions', 'payments', 'documents', 'summaries', 'quizzes', 'quiz_attempts', 'quiz_answers',
  'flashcard_decks', 'flashcards', 'flashcard_reviews', 'study_sessions', 'user_progress', 'xp_events',
  'user_achievements', 'user_challenges', 'user_rewards', 'notifications', 'notification_preferences',
  'ai_conversations', 'ai_messages', 'ai_usage',
];

export default route(
  { methods: ['GET'], auth: true, rateLimit: { key: (c) => `export:${c.user!.id}`, max: 5, windowSec: 3600 } },
  async ({ res, user, jwt }) => {
    // Lecture « au nom de l'utilisateur » : RLS garantit qu'on n'exporte que ses lignes
    const sb = asUser(jwt);
    const data: Record<string, unknown> = {
      exported_at: new Date().toISOString(),
      account: { id: user.id, email: user.email, created_at: user.created_at, email_confirmed_at: user.email_confirmed_at },
    };
    for (const t of TABLES) {
      const { data: rows } = await sb.from(t).select('*').limit(10_000);
      data[t] = rows || [];
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="relbrain-mes-donnees-${new Date().toISOString().slice(0, 10)}.json"`);
    res.status(200).send(JSON.stringify(data, null, 2));
  },
);
