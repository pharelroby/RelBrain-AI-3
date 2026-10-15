/* Découpage du texte en chunks pour le RAG.
   ~3 500 caractères (≈ 900 tokens) par chunk, chevauchement de 300 caractères,
   coupure de préférence entre paragraphes puis entre phrases.             */
export interface Chunk {
  index: number;
  content: string;
  tokens: number;
}

const TARGET = 3500;
const OVERLAP = 300;

export const approxTokens = (s: string) => Math.ceil(s.length / 4);

export function chunkText(text: string): Chunk[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= TARGET) { pieces.push(p); continue; }
    // Paragraphe trop long : découpe par phrases
    const sentences = p.match(/[^.!?…]+[.!?…]+[\])'"»]*\s*|[^.!?…]+$/g) || [p];
    let buf = '';
    for (const s of sentences) {
      if ((buf + s).length > TARGET && buf) { pieces.push(buf.trim()); buf = ''; }
      if (s.length > TARGET) {
        for (let i = 0; i < s.length; i += TARGET) pieces.push(s.slice(i, i + TARGET));
      } else buf += s;
    }
    if (buf.trim()) pieces.push(buf.trim());
  }

  const chunks: Chunk[] = [];
  let current = '';
  for (const piece of pieces) {
    if ((current + '\n\n' + piece).length > TARGET && current) {
      chunks.push({ index: chunks.length, content: current, tokens: approxTokens(current) });
      current = current.slice(-OVERLAP) + '\n\n' + piece;
    } else {
      current = current ? current + '\n\n' + piece : piece;
    }
  }
  if (current.trim()) chunks.push({ index: chunks.length, content: current, tokens: approxTokens(current) });
  return chunks;
}

/**
 * Échantillonne des chunks répartis sur tout le document pour tenir dans un
 * budget de caractères (évite que l'IA ne voie que le début du cours).
 */
export function sampleAcross(chunks: { content: string }[], budgetChars: number): string {
  if (!chunks.length) return '';
  const total = chunks.reduce((n, c) => n + c.content.length, 0);
  if (total <= budgetChars) return chunks.map((c) => c.content).join('\n\n');
  const take = Math.max(1, Math.floor(budgetChars / (total / chunks.length)));
  const step = chunks.length / take;
  const picked: string[] = [];
  for (let i = 0; i < take; i++) picked.push(chunks[Math.floor(i * step)].content);
  return picked.join('\n\n[…]\n\n').slice(0, budgetChars);
}
