/* ═══════════════════════════════════════════════════════════════════════════
   Pipeline d'analyse d'un document :
   pending → processing (extraction 25 % → découpage 45 % → embeddings 70 %
   → analyse IA 90 %) → ready 100 %. Chaque étape met à jour la ligne
   « documents » : le navigateur suit l'avancement en temps réel (Realtime).
   ═══════════════════════════════════════════════════════════════════════════ */
import { admin } from './supabase';
import { HttpError } from './http';
import { extractText } from './extract';
import { chunkText, sampleAcross } from './chunk';
import { embed, generateJSON } from './ai/openai';
import { AnalysisSchema, analyzePrompt, type Analysis, type LearnerProfile } from './ai/prompts';

export async function loadProfile(userId: string): Promise<LearnerProfile> {
  const { data } = await admin()
    .from('profiles')
    .select('first_name, school_level, field, country, language, goals')
    .eq('id', userId)
    .maybeSingle();
  return {
    firstName: data?.first_name,
    schoolLevel: data?.school_level,
    field: data?.field,
    country: data?.country,
    language: data?.language === 'en' ? 'en' : 'fr',
    goals: data?.goals || [],
  };
}

async function setState(docId: string, patch: Record<string, unknown>) {
  const { error } = await admin().from('documents').update(patch).eq('id', docId);
  if (error) console.warn('[documents] mise à jour du statut impossible', error.message);
}

interface ProcessInput {
  docId: string;
  userId: string;
  buffer?: Buffer;
  mime?: string;
  text?: string;
  title: string;
}

export async function processDocument(input: ProcessInput) {
  const { docId, userId } = input;
  try {
    await setState(docId, { status: 'processing', progress: 10, status_message: 'Lecture du document…' });

    // 1. Extraction
    let text = input.text || '';
    let pages: number | undefined;
    let warning: string | undefined;
    if (input.buffer && input.mime) {
      const ex = await extractText(input.buffer, input.mime, userId);
      text = ex.text;
      pages = ex.pages;
      warning = ex.warning;
    }
    if (text.replace(/\s/g, '').length < 80) {
      throw new HttpError(422, 'empty_document', warning || 'Pas assez de texte exploitable dans ce document (minimum ~100 caractères).');
    }
    const words = text.split(/\s+/).filter(Boolean).length;
    await setState(docId, { progress: 25, page_count: pages ?? null, word_count: words, status_message: 'Découpage en notions…' });

    // 2. Découpage
    const chunks = chunkText(text);
    await setState(docId, { progress: 45, status_message: 'Indexation sémantique…' });

    // 3. Embeddings (recherche sémantique pour le chat et les quiz ciblés)
    const vectors = await embed(chunks.map((c) => c.content), userId, 'document_embed');
    await admin().from('document_chunks').delete().eq('document_id', docId);
    for (let i = 0; i < chunks.length; i += 100) {
      const rows = chunks.slice(i, i + 100).map((c, j) => ({
        document_id: docId,
        user_id: userId,
        chunk_index: c.index,
        content: c.content,
        token_count: c.tokens,
        embedding: vectors[i + j] as unknown as string,
      }));
      const { error } = await admin().from('document_chunks').insert(rows);
      if (error) throw new HttpError(500, 'chunk_insert_failed', "Impossible d'indexer le document.");
    }
    await setState(docId, { progress: 70, status_message: "L'IA repère les notions clés…" });

    // 4. Analyse IA
    const profile = await loadProfile(userId);
    const { system, prompt } = analyzePrompt(sampleAcross(chunks, 28_000), input.title, profile);
    const analysis: Analysis = await generateJSON({ userId, route: 'analyze', system, prompt, schema: AnalysisSchema, temperature: 0.2, maxTokens: 2500 });

    await setState(docId, {
      status: 'ready',
      progress: 100,
      status_message: warning || null,
      language: analysis.language,
      subject: analysis.subject,
      summary_short: analysis.summary_short,
      key_concepts: analysis.key_concepts,
    });
    await admin().from('summaries').insert({ document_id: docId, user_id: userId, kind: 'short', content: { tldr: analysis.summary_short, key_concepts: analysis.key_concepts } });

    // 5. Gamification : +15 XP, défi « importer des cours », série, badges
    const sb = admin();
    await sb.rpc('touch_streak', { p_user: userId });
    await sb.rpc('bump_challenges', { p_user: userId, p_metric: 'documents_uploaded', p_amount: 1 });
    const { data: xp } = await sb.rpc('add_xp', { p_user: userId, p_base: 15, p_reason: 'document', p_source: docId, p_bonus: 1, p_check: true });
    await sb.rpc('notify', {
      p_user: userId,
      p_category: 'ai',
      p_title: `« ${analysis.title} » est prêt ✨`,
      p_body: `${analysis.key_concepts.length} notions repérées · environ ${analysis.estimated_study_minutes} min d'étude.`,
      p_icon: '📄',
      p_link: `relbrain-quiz-setup.html?doc=${docId}`,
      p_data: { document_id: docId },
    });

    return { analysis, xp, warning };
  } catch (err) {
    const message = err instanceof HttpError ? err.message : "L'analyse a échoué. Réessaie dans quelques minutes.";
    await setState(docId, { status: 'failed', status_message: message });
    throw err;
  }
}

/**
 * Contexte de cours pour la génération : chunks répartis sur tout le document,
 * ou, si des notions sont ciblées, les passages les plus proches (RAG).
 */
export async function documentContext(
  docId: string,
  userId: string,
  opts: { budget?: number; focus?: string[]; query?: string } = {},
): Promise<{ title: string; subject: string | null; text: string }> {
  const budget = opts.budget ?? 30_000;
  const { data: doc } = await admin()
    .from('documents')
    .select('id, title, subject, status, user_id')
    .eq('id', docId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!doc) throw new HttpError(404, 'document_not_found', 'Document introuvable.');
  if (doc.status !== 'ready') throw new HttpError(409, 'document_not_ready', "Ce document est encore en cours d'analyse.");

  const q = opts.query || (opts.focus?.length ? opts.focus.join(', ') : '');
  if (q) {
    const [vector] = await embed([q], userId, 'rag_query');
    const { data: matches } = await admin().rpc('match_document_chunks', {
      p_query_embedding: vector as unknown as string,
      p_document: docId,
      p_user: userId,
      p_count: 8,
    });
    const relevant = ((matches || []) as { content: string; similarity: number }[]).filter((m) => m.similarity > 0.2);
    if (relevant.length) {
      const text = relevant.map((m) => m.content).join('\n\n[…]\n\n').slice(0, budget);
      if (opts.query || text.length > budget * 0.5) return { title: doc.title, subject: doc.subject, text };
    }
  }

  const { data: chunks } = await admin()
    .from('document_chunks')
    .select('content, chunk_index')
    .eq('document_id', docId)
    .order('chunk_index');
  return { title: doc.title, subject: doc.subject, text: sampleAcross(chunks || [], budget) };
}
