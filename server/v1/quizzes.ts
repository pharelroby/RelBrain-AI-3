/* ═══════════════════════════════════════════════════════════════════════════
   API PUBLIQUE v1 — /api/v1/quizzes
   Authentification : Authorization: Bearer rb_live_…   (60 req/min/clé)
   GET  ?limit=20          → liste des quiz du titulaire de la clé
   GET  ?id=…              → un quiz et ses questions (sans les réponses)
   POST { text, count, type, difficulty, title? }  (scope « write »)
                           → génère un quiz depuis un texte
   Documentation : relbrain-integrations.html
   ═══════════════════════════════════════════════════════════════════════════ */
import { z } from 'zod';
import { route, parse, HttpError } from '../../lib/http';
import { admin } from '../../lib/supabase';
import { authenticateApiKey } from '../../lib/api-keys';
import { createQuiz, QuizBody } from '../../lib/quiz';

export default route({ methods: ['GET', 'POST'], publicCors: true }, async ({ req }) => {
  if (req.method === 'GET') {
    const { userId } = await authenticateApiKey(req, 'read');
    const q = parse(z.object({ id: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(20) }), req.query);
    if (q.id) {
      const { data: quiz } = await admin()
        .from('quizzes')
        .select('id, title, subject, difficulty, question_type, question_count, created_at')
        .eq('id', q.id)
        .eq('user_id', userId)
        .maybeSingle();
      if (!quiz) throw new HttpError(404, 'not_found', 'Quiz introuvable.');
      const { data: questions } = await admin()
        .from('quiz_questions')
        .select('id, position, type, prompt, options, concept, points')
        .eq('quiz_id', q.id)
        .order('position');
      return { data: { ...quiz, questions } };
    }
    const { data } = await admin()
      .from('quizzes')
      .select('id, title, subject, difficulty, question_type, question_count, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(q.limit);
    return { data: data || [] };
  }

  const { userId } = await authenticateApiKey(req, 'write');
  const body = parse(QuizBody.pick({ text: true, count: true, type: true, difficulty: true, title: true }).extend({ text: z.string().min(100).max(200_000) }), req.body);
  const result = await createQuiz(userId, { ...body, settings: { shuffle: true } }, { route: 'api_v1_quiz' });
  return { data: result.quiz };
});
