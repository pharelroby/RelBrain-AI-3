/* POST /api/ai/analyze { document_id } — (ré)analyse un document prêt :
   titre, matière, résumé court, notions clés, temps d'étude estimé. */
import { z } from 'zod';
import { route, parse } from '../../lib/http';
import { admin } from '../../lib/supabase';
import { assertQuota, assertAiBurst } from '../../lib/quota';
import { generateJSON } from '../../lib/ai/openai';
import { AnalysisSchema, analyzePrompt } from '../../lib/ai/prompts';
import { documentContext, loadProfile } from '../../lib/documents';

const Body = z.object({ document_id: z.string().uuid() });

export default route({ methods: ['POST'], auth: true }, async ({ req, user }) => {
  const { document_id } = parse(Body, req.body);
  const quota = await assertQuota(user.id, 'ai_requests');
  await assertAiBurst(user.id, quota.plan);

  const ctx = await documentContext(document_id, user.id, { budget: 28_000 });
  const { system, prompt } = analyzePrompt(ctx.text, ctx.title, await loadProfile(user.id));
  const analysis = await generateJSON({ userId: user.id, route: 'analyze', system, prompt, schema: AnalysisSchema, temperature: 0.2, maxTokens: 2500 });

  await admin()
    .from('documents')
    .update({ subject: analysis.subject, summary_short: analysis.summary_short, key_concepts: analysis.key_concepts, language: analysis.language })
    .eq('id', document_id)
    .eq('user_id', user.id);
  return { analysis };
});
