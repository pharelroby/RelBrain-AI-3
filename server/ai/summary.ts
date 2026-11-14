/* POST /api/ai/summary { document_id, kind } — fiche de révision.
   kind : short (gratuit) · key_points (gratuit) · detailed (Pro/Premium).
   Les résumés sont mis en cache ; regenerate=true pour en créer un nouveau. */
import { z } from 'zod';
import { route, parse, HttpError } from '../../lib/http';
import { admin } from '../../lib/supabase';
import { assertQuota, assertAiBurst, hasFeature } from '../../lib/quota';
import { generateJSON } from '../../lib/ai/openai';
import { SummarySchema, summaryPrompt } from '../../lib/ai/prompts';
import { documentContext, loadProfile } from '../../lib/documents';

const Body = z.object({
  document_id: z.string().uuid(),
  kind: z.enum(['short', 'detailed', 'key_points']).default('short'),
  regenerate: z.boolean().default(false),
});

export default route({ methods: ['POST'], auth: true }, async ({ req, user }) => {
  const body = parse(Body, req.body);
  const sb = admin();

  if (!body.regenerate) {
    const { data: cached } = await sb
      .from('summaries')
      .select('content, created_at')
      .eq('document_id', body.document_id)
      .eq('user_id', user.id)
      .eq('kind', body.kind)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cached && (cached.content as { sections?: unknown }).sections) return { summary: cached.content, cached: true };
  }

  const quota = await assertQuota(user.id, 'ai_requests');
  await assertAiBurst(user.id, quota.plan);
  if (body.kind === 'detailed' && !hasFeature(quota, 'detailed_summary')) {
    throw new HttpError(402, 'feature_locked', 'Le résumé détaillé est inclus dans RelBrain Pro. Le résumé court et les points clés restent gratuits.', {
      kind: 'detailed_summary',
    });
  }

  const ctx = await documentContext(body.document_id, user.id, { budget: body.kind === 'detailed' ? 60_000 : 30_000 });
  const { system, prompt } = summaryPrompt({ source: ctx.text, kind: body.kind, profile: await loadProfile(user.id) });
  const summary = await generateJSON({
    userId: user.id,
    route: 'summary',
    system,
    prompt,
    schema: SummarySchema,
    temperature: 0.3,
    maxTokens: body.kind === 'detailed' ? 6000 : 2500,
  });

  await sb.from('summaries').insert({ document_id: body.document_id, user_id: user.id, kind: body.kind, content: summary });
  return { summary, cached: false };
});
