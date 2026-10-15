/* POST /api/ai/flashcards — génère un paquet de flashcards (révision SM-2). */
import { z } from 'zod';
import { route, parse, HttpError } from '../../lib/http';
import { admin } from '../../lib/supabase';
import { assertQuota, assertAiBurst } from '../../lib/quota';
import { generateJSON } from '../../lib/ai/openai';
import { FlashcardsSchema, flashcardsPrompt } from '../../lib/ai/prompts';
import { loadProfile } from '../../lib/documents';
import { resolveSource } from '../../lib/ai/source';

const Body = z.object({
  document_id: z.string().uuid().optional(),
  text: z.string().max(200_000).optional(),
  subject: z.string().max(60).optional(),
  count: z.number().int().min(3).max(60).default(15),
  deck_id: z.string().uuid().optional(),
  deck_title: z.string().max(160).optional(),
});

export default route({ methods: ['POST'], auth: true }, async ({ req, user }) => {
  const body = parse(Body, req.body);
  const quota = await assertQuota(user.id, 'ai_requests');
  await assertAiBurst(user.id, quota.plan);
  const count = quota.plan === 'free' ? Math.min(body.count, 20) : body.count;

  const source = await resolveSource(user.id, body, 28_000);
  const { system, prompt } = flashcardsPrompt({ source: source.text, count, profile: await loadProfile(user.id) });
  const deck = await generateJSON({
    userId: user.id,
    route: 'flashcards',
    system,
    prompt,
    schema: FlashcardsSchema,
    temperature: 0.4,
    maxTokens: Math.min(12_000, 400 + count * 180),
  });

  const sb = admin();
  let deckId = body.deck_id;
  if (deckId) {
    const { data } = await sb.from('flashcard_decks').select('id').eq('id', deckId).eq('user_id', user.id).maybeSingle();
    if (!data) throw new HttpError(404, 'deck_not_found', 'Paquet introuvable.');
  } else {
    const { data, error } = await sb
      .from('flashcard_decks')
      .insert({ user_id: user.id, document_id: source.documentId, title: (body.deck_title || deck.deck_title).slice(0, 160), subject: source.subject })
      .select('id')
      .single();
    if (error || !data) throw new HttpError(500, 'deck_insert_failed', "Le paquet n'a pas pu être créé.");
    deckId = data.id;
  }

  const { data: cards, error } = await sb
    .from('flashcards')
    .insert(deck.cards.slice(0, count).map((c) => ({ deck_id: deckId, user_id: user.id, front: c.front, back: c.back, concept: c.concept })))
    .select('id, front, back, concept, due_at');
  if (error) throw new HttpError(500, 'cards_insert_failed', "Les cartes n'ont pas pu être enregistrées.");

  return { deck: { id: deckId, title: body.deck_title || deck.deck_title, subject: source.subject }, cards };
});
