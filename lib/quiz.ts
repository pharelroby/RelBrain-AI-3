/* Génération + enregistrement d'un quiz (partagé par /api/ai/quiz et l'API
   publique /api/v1/quizzes). Les bonnes réponses ne sont jamais renvoyées. */
import { z } from 'zod';
import { HttpError } from './http';
import { admin, asUser } from './supabase';
import { assertQuota, assertAiBurst, hasFeature } from './quota';
import { generateJSON } from './ai/openai';
import { QuizSchema, quizPrompt, toQuestionRow } from './ai/prompts';
import { loadProfile } from './documents';
import { resolveSource } from './ai/source';

export const QuizBody = z.object({
  document_id: z.string().uuid().optional(),
  text: z.string().max(200_000).optional(),
  subject: z.string().max(60).optional(),
  count: z.number().int().min(1).max(50).default(10),
  type: z.enum(['qcm', 'vf', 'court', 'calcul', 'texte', 'mixte']).default('qcm'),
  difficulty: z.enum(['facile', 'moyen', 'difficile', 'expert']).default('moyen'),
  focus_concepts: z.array(z.string().max(120)).max(10).optional(),
  settings: z.object({ timer: z.boolean(), explain: z.boolean(), adapt: z.boolean(), shuffle: z.boolean() }).partial().default({}),
  title: z.string().max(160).optional(),
});
export type QuizInput = z.infer<typeof QuizBody>;

/** Mélange les options d'un QCM et recalcule l'index de la bonne réponse. */
function shuffleQcm<T extends { type: string; options?: string[]; answer_index?: number }>(q: T): T {
  if (q.type !== 'qcm' || !q.options || q.answer_index === undefined) return q;
  const order = q.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...q, options: order.map((i) => q.options![i]), answer_index: order.indexOf(q.answer_index) };
}

export async function createQuiz(userId: string, body: QuizInput, opts: { jwt?: string; route?: string } = {}) {
  const quota = await assertQuota(userId, 'quizzes');
  await assertQuota(userId, 'ai_requests');
  await assertAiBurst(userId, quota.plan);
  if (body.count > quota.max_questions) {
    throw new HttpError(402, 'quota_exceeded', `Ton forfait permet ${quota.max_questions} questions par quiz. Passe à Pro pour aller jusqu'à 30.`, {
      kind: 'max_questions',
      limit: quota.max_questions,
    });
  }

  // Mode adaptatif : points faibles de l'élève (Pro / Premium)
  let focus = body.focus_concepts || [];
  if (body.settings.adapt && opts.jwt && hasFeature(quota, 'adaptive') && !focus.length) {
    const { data } = await asUser(opts.jwt).rpc('get_weak_points', { p_limit: 6 });
    focus = ((data || []) as { concept: string }[]).map((w) => w.concept);
  }

  const source = await resolveSource(userId, { document_id: body.document_id, text: body.text, subject: body.subject, focus }, 30_000);

  // Évite de reposer les mêmes questions sur ce document
  let avoid: string[] = [];
  if (source.documentId) {
    const { data: prev } = await admin().from('quizzes').select('id').eq('user_id', userId).eq('document_id', source.documentId).limit(10);
    const ids = (prev || []).map((q: { id: string }) => q.id);
    if (ids.length) {
      const { data } = await admin().from('quiz_questions').select('prompt').in('quiz_id', ids).limit(30);
      avoid = (data || []).map((r: { prompt: string }) => r.prompt);
    }
  }

  const { system, prompt } = quizPrompt({
    source: source.text,
    count: body.count,
    type: body.type,
    difficulty: body.difficulty,
    focusConcepts: focus,
    avoidPrompts: avoid,
    profile: await loadProfile(userId),
  });
  const generated = await generateJSON({
    userId,
    route: opts.route || 'quiz',
    system,
    prompt,
    schema: QuizSchema,
    temperature: 0.5,
    maxTokens: Math.min(16_000, 600 + body.count * 380),
  });

  let questions = generated.questions.slice(0, body.count);
  if (body.settings.shuffle !== false) questions = questions.map(shuffleQcm);

  const sb = admin();
  const { data: quiz, error } = await sb
    .from('quizzes')
    .insert({
      user_id: userId,
      document_id: source.documentId,
      title: (body.title || generated.title).slice(0, 160),
      subject: source.subject,
      source: focus.length && body.settings.adapt ? 'weak_points' : source.mode,
      difficulty: body.difficulty,
      question_type: body.type,
      question_count: questions.length,
      settings: body.settings,
    })
    .select('*')
    .single();
  if (error || !quiz) throw new HttpError(500, 'quiz_insert_failed', "Le quiz n'a pas pu être enregistré.");

  const rows = questions.map((q, i) => ({ ...toQuestionRow(q), quiz_id: quiz.id, user_id: userId, position: i + 1 }));
  const { data: inserted, error: qErr } = await sb
    .from('quiz_questions')
    .insert(rows)
    .select('id, position, type, prompt, options, concept, difficulty, points')
    .order('position');
  if (qErr) {
    await sb.from('quizzes').delete().eq('id', quiz.id);
    throw new HttpError(500, 'quiz_insert_failed', "Le quiz n'a pas pu être enregistré.");
  }
  return { quiz: { ...quiz, questions: inserted }, focus_concepts: focus };
}
