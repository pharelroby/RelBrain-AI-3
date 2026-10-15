/* Construit le texte source d'une génération IA à partir d'un document,
   d'un texte collé ou d'une simple matière. */
import { HttpError } from '../http';
import { documentContext } from '../documents';

export interface SourceInput {
  document_id?: string;
  text?: string;
  subject?: string;
  focus?: string[];
}

export interface Source {
  text: string;
  title: string;
  subject: string | null;
  documentId: string | null;
  mode: 'document' | 'text' | 'subject';
}

export async function resolveSource(userId: string, input: SourceInput, budget = 30_000): Promise<Source> {
  if (input.document_id) {
    const ctx = await documentContext(input.document_id, userId, { budget, focus: input.focus });
    return { text: ctx.text, title: ctx.title, subject: ctx.subject, documentId: input.document_id, mode: 'document' };
  }
  if (input.text) {
    const text = input.text.trim();
    if (text.replace(/\s/g, '').length < 100) {
      throw new HttpError(400, 'text_too_short', 'Colle au moins 100 caractères de cours pour une génération de qualité.');
    }
    return { text: text.slice(0, budget), title: 'Texte collé', subject: input.subject || null, documentId: null, mode: 'text' };
  }
  if (input.subject) {
    return {
      text:
        `[MODE MATIÈRE — exception à la règle 1] Aucun cours n'est fourni. Appuie-toi sur le programme officiel de « ${input.subject} » ` +
        `correspondant au niveau de l'élève (programmes camerounais / africains francophones lorsque c'est pertinent), ` +
        `en restant sur des notions classiques, vérifiables et sans ambiguïté.` +
        (input.focus?.length ? ` Notions à privilégier : ${input.focus.join(', ')}.` : ''),
      title: input.subject,
      subject: input.subject,
      documentId: null,
      mode: 'subject',
    };
  }
  throw new HttpError(400, 'missing_source', 'Choisis un document, colle un texte ou sélectionne une matière.');
}
