/* POST /api/ai/chat — assistant conversationnel en streaming (Server-Sent Events).
   Corps : { message, conversation_id?, document_id? }
   Flux de sortie :  data: {"delta":"…"}  …  data: {"done":true,"conversation_id":"…"}
   Les messages sont enregistrés dans ai_conversations / ai_messages.          */
import { z } from 'zod';
import type OpenAI from 'openai';
import { route, parse, HttpError } from '../../lib/http';
import { admin } from '../../lib/supabase';
import { assertQuota, assertAiBurst, getQuota } from '../../lib/quota';
import { openai, MODELS, trackUsage, toHttpError, chatExtras, tokenLimit } from '../../lib/ai/openai';
import { chatSystemPrompt } from '../../lib/ai/prompts';
import { documentContext, loadProfile } from '../../lib/documents';

const Body = z.object({
  message: z.string().trim().min(1).max(4000),
  conversation_id: z.string().uuid().optional(),
  document_id: z.string().uuid().optional(),
});

// ═══════════════════════════════════════════════════════════════
// 🔒 TUTEUR IA RÉSERVÉ AUX FORMULES PAYANTES (phase de test)
// ────────────────────────────────────────────────────────────────
// Le tuteur consomme beaucoup de jetons d'IA. Les élèves du plan
// gratuit reçoivent un message qui les oriente vers les quiz, les
// flashcards et les résumés. Les administrateurs y ont toujours accès,
// ainsi que les élèves passés en Pro / Premium dans la salle des profs.
// Pour l'ouvrir à tout le monde : TUTOR_FOR_FREE=true (Vercel + .env.local).
// ═══════════════════════════════════════════════════════════════
async function assertTutorAccess(userId: string) {
  if (process.env.TUTOR_FOR_FREE === 'true') return;
  const { plan } = await getQuota(userId);
  if (plan !== 'free') return;
  const { data: me } = await admin().from('profiles').select('is_admin').eq('id', userId).maybeSingle();
  if (me?.is_admin) return;
  throw new HttpError(
    403,
    'feature_locked',
    'Le tuteur IA fait partie des formules payantes, qui ouvriront bientôt. Avec le plan gratuit, tu peux déjà générer des quiz, des flashcards et des résumés à partir de tes cours.',
    { feature: 'tutor' },
  );
}

export default route({ methods: ['POST'], auth: true }, async ({ req, res, user }) => {
  const body = parse(Body, req.body);
  await assertTutorAccess(user.id);
  const quota = await assertQuota(user.id, 'ai_requests');
  await assertAiBurst(user.id, quota.plan);
  const sb = admin();

  // Conversation existante ou nouvelle
  let conversationId = body.conversation_id;
  let documentId = body.document_id || null;
  if (conversationId) {
    const { data: conv } = await sb.from('ai_conversations').select('id, document_id').eq('id', conversationId).eq('user_id', user.id).maybeSingle();
    if (!conv) throw new HttpError(404, 'conversation_not_found', 'Conversation introuvable.');
    documentId = documentId || conv.document_id;
  } else {
    const { data: conv, error } = await sb
      .from('ai_conversations')
      .insert({ user_id: user.id, document_id: documentId, title: body.message.slice(0, 80) })
      .select('id')
      .single();
    if (error || !conv) throw new HttpError(500, 'conversation_failed', 'Impossible de démarrer la conversation.');
    conversationId = conv.id;
  }

  const { data: history } = await sb
    .from('ai_messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('id', { ascending: false })
    .limit(12);

  let context = '';
  let documentTitle: string | undefined;
  if (documentId) {
    try {
      const ctx = await documentContext(documentId, user.id, { query: body.message, budget: 12_000 });
      context = ctx.text;
      documentTitle = ctx.title;
    } catch {
      /* document indisponible : on répond sans contexte */
    }
  }

  await sb.from('ai_messages').insert({ conversation_id: conversationId, user_id: user.id, role: 'user', content: body.message });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: chatSystemPrompt({ profile: await loadProfile(user.id), context, documentTitle }) },
    ...((history || []).reverse() as { role: 'user' | 'assistant'; content: string }[]).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: body.message },
  ];

  // Ouverture du flux : modèle principal, puis modèle de repli si l'appel échoue
  let stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk> | null = null;
  let model = MODELS.main;
  for (const m of [MODELS.main, MODELS.fallback]) {
    try {
      stream = await openai().chat.completions.create({
        model: m,
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.6,
        max_tokens: tokenLimit(1500),
        ...chatExtras,
        messages,
      });
      model = m;
      break;
    } catch (err) {
      if (m === MODELS.fallback) throw toHttpError(err);
    }
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  send({ conversation_id: conversationId });

  let full = '';
  let usage: OpenAI.CompletionUsage | undefined;
  try {
    for await (const chunk of stream!) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        full += delta;
        send({ delta });
      }
      if (chunk.usage) usage = chunk.usage;
    }
  } catch (err) {
    send({ error: "La réponse a été interrompue. Réessaie." });
    console.warn('[chat] flux interrompu', (err as Error).message);
  }

  if (full) {
    await sb.from('ai_messages').insert({ conversation_id: conversationId, user_id: user.id, role: 'assistant', content: full, tokens: usage?.completion_tokens });
    await sb.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
  }
  await trackUsage(user.id, 'chat', model, usage);
  await sb.rpc('bump_challenges', { p_user: user.id, p_metric: 'chat_messages', p_amount: 1 });

  send({ done: true, conversation_id: conversationId });
  res.end();
});
