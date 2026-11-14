/* POST /api/ai/quiz — génère un quiz depuis un document, un texte ou une matière.
   Les bonnes réponses restent en base : le navigateur ne les reçoit qu'après
   avoir répondu (RPC check_answer). Mode adaptatif : cible les points faibles.
   Logique partagée avec l'API publique : lib/quiz.ts                          */
import { route, parse } from '../../lib/http';
import { createQuiz, QuizBody } from '../../lib/quiz';

export default route({ methods: ['POST'], auth: true }, async ({ req, user, jwt }) => {
  const body = parse(QuizBody, req.body);
  return createQuiz(user.id, body, { jwt });
});
