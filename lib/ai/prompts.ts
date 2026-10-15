/* ═══════════════════════════════════════════════════════════════════════════
   RELBRAIN — PROMPT ENGINEERING
   Tous les prompts de l'IA vivent ici, avec le schéma (zod) de la réponse
   attendue. Règles communes :
   · L'IA ne s'appuie QUE sur le cours fourni (pas d'invention).
   · Langue de l'élève (fr par défaut), registre bienveillant, tutoiement.
   · Contexte africain francophone : programmes du Bac/GCE camerounais,
     concours (ENS, Polytech, FMSB, ENAM…), exemples locaux quand pertinent.
   · Sorties en JSON strict, validées avant d'être enregistrées.
   ═══════════════════════════════════════════════════════════════════════════ */
import { z } from 'zod';

export type Difficulty = 'facile' | 'moyen' | 'difficile' | 'expert';
export type QuestionType = 'qcm' | 'vf' | 'court' | 'calcul' | 'texte' | 'mixte';

export interface LearnerProfile {
  firstName?: string | null;
  schoolLevel?: string | null; // college | lycee | bts | licence | master | prepa
  field?: string | null;
  country?: string | null;
  language?: 'fr' | 'en';
  goals?: string[];
}

const LEVEL_LABEL: Record<string, string> = {
  college: 'collège',
  lycee: 'lycée (préparation au Baccalauréat / GCE)',
  bts: 'BTS / DUT',
  licence: 'Licence (université)',
  master: 'Master (université)',
  prepa: 'classe préparatoire / concours (ENS, Polytechnique, FMSB, ENAM…)',
};

function learnerContext(p?: LearnerProfile): string {
  if (!p) return '';
  const parts = [
    p.schoolLevel ? `Niveau : ${LEVEL_LABEL[p.schoolLevel] || p.schoolLevel}` : '',
    p.field ? `Filière : ${p.field}` : '',
    p.country ? `Pays : ${p.country}` : '',
    p.goals?.length ? `Objectifs : ${p.goals.join(', ')}` : '',
  ].filter(Boolean);
  return parts.length ? `\n\nPROFIL DE L'ÉLÈVE\n${parts.join('\n')}` : '';
}

function lang(p?: LearnerProfile) {
  return p?.language === 'en' ? 'anglais' : 'français';
}

const BASE_SYSTEM = (p?: LearnerProfile) => `Tu es RelBrain, un coach d'étude expert en pédagogie et en sciences cognitives.
Tu aides des lycéens, étudiants et candidats aux concours, principalement en Afrique francophone.
Règles absolues :
1. Tu t'appuies UNIQUEMENT sur le contenu du cours fourni. Si une information n'y est pas, tu ne l'inventes pas.
2. Tu écris en ${lang(p)}, avec des phrases claires, précises et bienveillantes (tutoiement).
3. Les formules mathématiques sont écrites en texte lisible (ex. x^2, √(a+b), ∑, ≤), sans LaTeX.
4. Tu réponds toujours avec un objet JSON valide respectant exactement le format demandé.${learnerContext(p)}`;

const DIFFICULTY_GUIDE: Record<Difficulty, string> = {
  facile: 'FACILE — mémorisation et définitions (niveau 1 de Bloom : se souvenir).',
  moyen: 'MOYEN — compréhension : expliquer, reformuler, reconnaître un exemple (niveau 2 de Bloom).',
  difficile: 'DIFFICILE — application à des situations nouvelles, calculs, résolution (niveau 3 de Bloom).',
  expert: "EXPERT — analyse, comparaison, pièges classiques d'examen et de concours (niveaux 4-5 de Bloom).",
};

const TYPE_GUIDE: Record<QuestionType, string> = {
  qcm: 'QCM : exactement 4 options, une seule bonne réponse. Distracteurs plausibles, issus des confusions fréquentes. Jamais « toutes les réponses ».',
  vf: 'Vrai/Faux : options ["Vrai","Faux"]. Affirmations précises, sans double négation.',
  court: 'Réponse courte : un mot ou une courte expression. Fournis answer_text et une liste « accepted » de variantes acceptables (synonymes, sans accents, singulier/pluriel).',
  calcul: 'Calcul : énoncé chiffré à résultat numérique unique. Fournis answer_number et une tolérance raisonnable ; détaille le raisonnement dans explanation.',
  texte: 'Réponse rédigée : question ouverte type examen. Fournis model_answer (corrigé modèle en 3-6 phrases) ; l\'élève s\'auto-évaluera.',
  mixte: 'Mixte : environ 50 % QCM, 20 % Vrai/Faux, 20 % réponse courte, 10 % calcul ou rédaction selon la matière.',
};


// ═══ 1. ANALYSE D'UN DOCUMENT ══════════════════════════════════════════════
export const AnalysisSchema = z.object({
  title: z.string().min(2).max(200),
  subject: z.string().min(2).max(60),
  language: z.enum(['fr', 'en', 'autre']).default('fr'),
  level: z.string().max(60).optional(),
  summary_short: z.string().min(20).max(1200),
  key_concepts: z
    .array(z.object({ name: z.string().min(1).max(120), definition: z.string().min(3).max(500), importance: z.number().int().min(1).max(3) }))
    .min(1)
    .max(25),
  estimated_study_minutes: z.number().int().min(1).max(600),
  suggested_question_count: z.number().int().min(5).max(50),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export function analyzePrompt(text: string, fileTitle: string, p?: LearnerProfile) {
  return {
    system: BASE_SYSTEM(p),
    prompt: `Analyse ce support de cours intitulé « ${fileTitle} ».

Produis un objet JSON :
{
  "title": "titre clair du cours (reformule si le nom de fichier est peu parlant)",
  "subject": "matière en un ou deux mots (ex. Mathématiques, Physique-Chimie, SVT, Histoire, Informatique, Droit, Économie, Philosophie, Médecine…)",
  "language": "fr" | "en" | "autre",
  "level": "niveau estimé (ex. Terminale C, L2 Informatique)",
  "summary_short": "résumé en 3 à 5 phrases : de quoi parle le cours et ce qu'il faut en retenir",
  "key_concepts": [{ "name": "notion", "definition": "définition fidèle au cours, 1-2 phrases", "importance": 1|2|3 }],
  "estimated_study_minutes": nombre,
  "suggested_question_count": nombre entre 5 et 50
}
Classe key_concepts du plus important au moins important (importance 3 = incontournable à l'examen). 5 à 20 notions.

COURS :
"""
${text}
"""`,
  };
}


// ═══ 2. GÉNÉRATION DE QUIZ ═════════════════════════════════════════════════
const QuestionSchema = z
  .object({
    type: z.enum(['qcm', 'vf', 'court', 'calcul', 'texte']),
    prompt: z.string().min(5).max(800),
    options: z.array(z.string().min(1).max(300)).optional(),
    answer_index: z.number().int().min(0).max(5).optional(),
    answer_text: z.string().max(200).optional(),
    accepted: z.array(z.string().max(200)).max(10).optional(),
    answer_number: z.number().optional(),
    tolerance: z.number().min(0).optional(),
    model_answer: z.string().max(2000).optional(),
    explanation: z.string().min(5).max(1200),
    concept: z.string().min(1).max(120),
    difficulty: z.enum(['facile', 'moyen', 'difficile', 'expert']).optional(),
  })
  .superRefine((q, ctx) => {
    if (q.type === 'qcm' && (!q.options || q.options.length !== 4 || q.answer_index === undefined || q.answer_index > 3))
      ctx.addIssue({ code: 'custom', message: 'un QCM a 4 options et answer_index entre 0 et 3' });
    if (q.type === 'vf' && (!q.options || q.options.length !== 2 || q.answer_index === undefined || q.answer_index > 1))
      ctx.addIssue({ code: 'custom', message: 'un Vrai/Faux a 2 options et answer_index 0 ou 1' });
    if (q.type === 'court' && !q.answer_text) ctx.addIssue({ code: 'custom', message: 'answer_text requis' });
    if (q.type === 'calcul' && typeof q.answer_number !== 'number') ctx.addIssue({ code: 'custom', message: 'answer_number requis' });
    if (q.type === 'texte' && !q.model_answer) ctx.addIssue({ code: 'custom', message: 'model_answer requis' });
  });

export const QuizSchema = z.object({
  title: z.string().min(2).max(160),
  questions: z.array(QuestionSchema).min(1).max(50),
});
export type GeneratedQuiz = z.infer<typeof QuizSchema>;
export type GeneratedQuestion = GeneratedQuiz['questions'][number];

export function quizPrompt(o: {
  source: string;
  count: number;
  type: QuestionType;
  difficulty: Difficulty;
  focusConcepts?: string[];
  avoidPrompts?: string[];
  profile?: LearnerProfile;
}) {
  return {
    system: BASE_SYSTEM(o.profile),
    prompt: `Crée un quiz de EXACTEMENT ${o.count} questions à partir du cours ci-dessous.

DIFFICULTÉ : ${DIFFICULTY_GUIDE[o.difficulty]}
TYPE : ${TYPE_GUIDE[o.type]}
${o.focusConcepts?.length ? `PRIORITÉ : au moins 60 % des questions portent sur ces notions où l'élève se trompe souvent : ${o.focusConcepts.join(', ')}.\n` : ''}${o.avoidPrompts?.length ? `NE REPRENDS PAS ces questions déjà posées : ${o.avoidPrompts.slice(0, 20).map((p) => `« ${p.slice(0, 80)} »`).join(' ; ')}.\n` : ''}
Exigences pédagogiques :
- Couvre l'ensemble du cours (pas seulement le début), une notion par question.
- Chaque « explanation » explique POURQUOI la bonne réponse est juste et pourquoi le piège principal est faux (2-4 phrases).
- « concept » = nom court de la notion évaluée (réutilisé pour détecter les points faibles).
- Répartis la place de la bonne réponse dans les QCM (pas toujours la même lettre).

Format JSON :
{
  "title": "titre du quiz",
  "questions": [
    { "type": "qcm", "prompt": "…", "options": ["…","…","…","…"], "answer_index": 2, "explanation": "…", "concept": "…", "difficulty": "${o.difficulty}" },
    { "type": "vf", "prompt": "…", "options": ["Vrai","Faux"], "answer_index": 0, "explanation": "…", "concept": "…" },
    { "type": "court", "prompt": "…", "answer_text": "…", "accepted": ["…"], "explanation": "…", "concept": "…" },
    { "type": "calcul", "prompt": "…", "answer_number": 12.5, "tolerance": 0.1, "explanation": "…", "concept": "…" },
    { "type": "texte", "prompt": "…", "model_answer": "…", "explanation": "…", "concept": "…" }
  ]
}

COURS :
"""
${o.source}
"""`,
  };
}

/** Convertit une question générée en ligne « quiz_questions ». */
export function toQuestionRow(q: GeneratedQuestion) {
  let correct: Record<string, unknown>;
  switch (q.type) {
    case 'qcm':
    case 'vf':
      correct = { index: q.answer_index };
      break;
    case 'court':
      correct = { value: q.answer_text, accepted: q.accepted || [] };
      break;
    case 'calcul':
      correct = { number: q.answer_number, tolerance: q.tolerance ?? null };
      break;
    default:
      correct = { model: q.model_answer };
  }
  return {
    type: q.type,
    prompt: q.prompt,
    options: q.type === 'qcm' || q.type === 'vf' ? q.options : null,
    correct_answer: correct,
    explanation: q.explanation,
    concept: q.concept,
    difficulty: q.difficulty || null,
    points: q.type === 'texte' || q.type === 'calcul' ? 2 : 1,
  };
}


// ═══ 3. FLASHCARDS ═════════════════════════════════════════════════════════
export const FlashcardsSchema = z.object({
  deck_title: z.string().min(2).max(160),
  cards: z
    .array(z.object({ front: z.string().min(3).max(300), back: z.string().min(1).max(800), concept: z.string().min(1).max(120) }))
    .min(1)
    .max(100),
});
export type GeneratedDeck = z.infer<typeof FlashcardsSchema>;

export function flashcardsPrompt(o: { source: string; count: number; profile?: LearnerProfile }) {
  return {
    system: BASE_SYSTEM(o.profile),
    prompt: `Crée EXACTEMENT ${o.count} flashcards de révision à partir du cours ci-dessous.

Principes (règles de Wozniak pour la mémorisation) :
- Une seule idée par carte (principe d'information minimale).
- Recto = question précise ou terme à définir ; verso = réponse courte (1-2 phrases max), mémorisable.
- Privilégie le rappel actif : « Que signifie… ? », « Quelle est la formule de… ? », « Cite… ».
- Pas de cartes ambiguës, pas de listes de plus de 3 éléments au verso.
- « concept » = nom court de la notion.

Format JSON : { "deck_title": "…", "cards": [{ "front": "…", "back": "…", "concept": "…" }] }

COURS :
"""
${o.source}
"""`,
  };
}


// ═══ 4. RÉSUMÉS ════════════════════════════════════════════════════════════
export const SummarySchema = z.object({
  title: z.string().min(2).max(200),
  tldr: z.string().min(10).max(600),
  sections: z
    .array(z.object({ heading: z.string().min(1).max(160), points: z.array(z.string().min(2).max(600)).min(1).max(12) }))
    .min(1)
    .max(15),
  key_terms: z.array(z.object({ term: z.string().min(1).max(120), definition: z.string().min(2).max(400) })).max(30),
  exam_tips: z.array(z.string().min(5).max(400)).max(8),
});
export type GeneratedSummary = z.infer<typeof SummarySchema>;

export function summaryPrompt(o: { source: string; kind: 'short' | 'detailed' | 'key_points'; profile?: LearnerProfile }) {
  const length = {
    short: 'COURT : 2 à 4 sections, 2-3 points chacune. Lecture en 2 minutes.',
    detailed: 'DÉTAILLÉ : suis le plan du cours, 4 à 12 sections, tous les points importants, exemples inclus.',
    key_points: 'POINTS CLÉS : 1 à 3 sections maximum, uniquement l\'essentiel à savoir par cœur la veille de l\'examen.',
  }[o.kind];
  return {
    system: BASE_SYSTEM(o.profile),
    prompt: `Rédige une fiche de révision du cours ci-dessous.
FORMAT : ${length}

Format JSON :
{
  "title": "…",
  "tldr": "l'essentiel en 1-2 phrases",
  "sections": [{ "heading": "…", "points": ["…"] }],
  "key_terms": [{ "term": "…", "definition": "…" }],
  "exam_tips": ["piège fréquent ou conseil méthodologique pour l'examen"]
}

COURS :
"""
${o.source}
"""`,
  };
}


// ═══ 5. ASSISTANT CONVERSATIONNEL ══════════════════════════════════════════
export function chatSystemPrompt(o: { profile?: LearnerProfile; context?: string; documentTitle?: string }) {
  return `Tu es RelBrain, le coach d'étude personnel de ${o.profile?.firstName || "l'élève"}.
Tu écris en ${lang(o.profile)}, tu tutoies, tu es chaleureux mais exigeant.

Méthode :
- Tu fais RÉFLÉCHIR avant de donner la réponse : pour un exercice, propose d'abord un indice ou une question guidée (méthode socratique), puis la solution complète si l'élève la demande.
- Explications courtes et structurées (listes, étapes numérotées). Formules en texte lisible, sans LaTeX.
- Quand c'est utile, termine par UNE question de vérification pour ancrer la notion.
- Tu peux proposer : « Veux-tu que je génère un quiz / des flashcards sur ce point ? »
- Tu n'aides pas à tricher pendant un examen en cours, et tu restes sur des sujets scolaires et d'apprentissage.
${o.context ? `\nTu disposes d'extraits du cours « ${o.documentTitle || 'de l\'élève'} ». Appuie-toi dessus en priorité et signale quand une réponse dépasse le cours.\n\nEXTRAITS DU COURS :\n"""\n${o.context}\n"""` : ''}${learnerContext(o.profile)}`;
}
