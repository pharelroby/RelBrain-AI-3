/* ═══════════════════════════════════════════════════════════════════════════
   RELBRAIN — COMPTE DE DÉMONSTRATION
   ───────────────────────────────────────────────────────────────────────────
   Crée (ou remet à zéro) un compte rempli avec le contenu de
   content/demo/compte-demo.json : documents, flashcards, quiz, XP.

   1. Dans .env.local, remplis :
        DEMO_EMAIL=ton.adresse+demo@gmail.com
        DEMO_PASSWORD=un mot de passe que tu choisis
   2. Lance :  npm run demo
   3. Connecte-toi sur le site avec cette adresse et ce mot de passe.

   Relance la commande quand tu veux : le compte repart propre.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(__dirname, '..');

function loadEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
}
loadEnv(path.join(ROOT, '.env.local'));

function stop(msg: string): never {
  console.error('\n  ❌ ' + msg + '\n');
  process.exit(1);
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_EMAIL, DEMO_PASSWORD } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) stop('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant dans .env.local');
if (!DEMO_EMAIL || !/^\S+@\S+\.\S+$/.test(DEMO_EMAIL)) stop('Ajoute DEMO_EMAIL=une.adresse@email.com dans .env.local');
if (!DEMO_PASSWORD || DEMO_PASSWORD.length < 8) stop('Ajoute DEMO_PASSWORD=… (8 caractères minimum) dans .env.local');

type Demo = {
  profil: { prenom: string; nom: string; etablissement: string; niveau: string; filiere: string; pays: string; serie_de_jours: number; xp: number };
  documents: { titre: string; matiere: string; resume: string; notions: string[]; texte: string }[];
  flashcards: { paquet: string; document?: string; cartes: [string, string][] }[];
  quiz: { titre: string; document?: string; deja_fait?: { bonnes_reponses: number }; questions: { question: string; choix: string[]; bonne: number; explication?: string }[] }[];
};

let demo: Demo;
try {
  demo = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'demo', 'compte-demo.json'), 'utf8'));
} catch (e) {
  stop('content/demo/compte-demo.json est mal écrit (une virgule ou un guillemet en trop ?) : ' + (e as Error).message);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// Exécute une requête Supabase ; en cas d'erreur, explique laquelle et s'arrête.
async function must(p: PromiseLike<any>, what: string): Promise<any> {
  const { data, error } = await p;
  if (error) stop(`${what} : ${error.message}`);
  return data;
}

const DAY = 864e5;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

async function findUser(email: string) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) stop('Lecture des comptes : ' + error.message);
    const u = data.users.find((x) => (x.email || '').toLowerCase() === email.toLowerCase());
    if (u || data.users.length < 200) return u || null;
  }
  return null;
}

async function main() {
  const email = DEMO_EMAIL!.toLowerCase();
  const p = demo.profil;
  console.log('\n  🧠 Préparation du compte de démonstration…');

  // 1. Le compte (aucun email n'est envoyé : il est confirmé d'office)
  let user = await findUser(email);
  if (user) {
    await must(sb.auth.admin.updateUserById(user.id, { password: DEMO_PASSWORD, email_confirm: true }), 'Mise à jour du compte');
    console.log('  ↻ Compte existant remis à zéro');
  } else {
    const created = await must(sb.auth.admin.createUser({
      email, password: DEMO_PASSWORD, email_confirm: true,
      user_metadata: { first_name: p.prenom, last_name: p.nom },
    }), 'Création du compte');
    user = created.user!;
    console.log('  ✓ Compte créé');
  }
  const uid: string = user!.id;

  // 2. On efface l'ancien contenu
  for (const t of ['quizzes', 'flashcard_decks', 'documents', 'study_sessions']) {
    await must(sb.from(t).delete().eq('user_id', uid), `Nettoyage (${t})`);
  }

  // 3. Le profil
  await must(sb.from('profiles').upsert({
    id: uid, first_name: p.prenom, last_name: p.nom, institution: p.etablissement,
    school_level: p.niveau, field: p.filiere, country: p.pays, onboarding_done: true,
    streak_current: p.serie_de_jours, streak_best: p.serie_de_jours,
    last_study_date: new Date().toISOString().slice(0, 10),
  }), 'Profil');

  // 4. Les documents, déjà « analysés »
  const docIds: Record<string, string> = {};
  for (const [i, d] of demo.documents.entries()) {
    const row = await must(sb.from('documents').insert({
      user_id: uid, title: d.titre, subject: d.matiere, source: 'text', status: 'ready', progress: 100,
      word_count: d.texte.split(/\s+/).length, language: 'fr', summary_short: d.resume,
      key_concepts: d.notions.map((name, k) => ({ name, definition: '', importance: k < 2 ? 3 : 2 })),
      created_at: ago(9 - i * 3),
    }).select('id').single(), `Document « ${d.titre} »`);
    docIds[d.titre] = row.id;
    await must(sb.from('document_chunks').insert({ document_id: row.id, user_id: uid, chunk_index: 0, content: d.texte }), 'Texte du document');
  }
  console.log(`  ✓ ${demo.documents.length} documents`);

  // 5. Les flashcards (quelques-unes à réviser aujourd'hui)
  let nCards = 0;
  for (const deck of demo.flashcards) {
    const dk = await must(sb.from('flashcard_decks').insert({
      user_id: uid, title: deck.paquet, document_id: (deck.document && docIds[deck.document]) || null,
    }).select('id').single(), `Paquet « ${deck.paquet} »`);
    await must(sb.from('flashcards').insert(deck.cartes.map(([front, back], i) => ({
      deck_id: dk.id, user_id: uid, front, back,
      repetitions: i % 2, interval_days: i % 2 ? 3 : 0, due_at: i % 2 ? ago(-2) : ago(0.1),
    }))), 'Cartes');
    nCards += deck.cartes.length;
  }
  console.log(`  ✓ ${nCards} flashcards`);

  // 6. Les quiz
  for (const q of demo.quiz) {
    const quiz = await must(sb.from('quizzes').insert({
      user_id: uid, title: q.titre, document_id: (q.document && docIds[q.document]) || null,
      source: 'document', difficulty: 'moyen', question_type: 'qcm', question_count: q.questions.length,
      settings: { explain: true },
    }).select('id').single(), `Quiz « ${q.titre} »`);
    await must(sb.from('quiz_questions').insert(q.questions.map((x, i) => ({
      quiz_id: quiz.id, user_id: uid, position: i + 1, type: 'qcm', prompt: x.question,
      options: x.choix, correct_answer: { index: x.bonne }, explanation: x.explication || null,
    }))), 'Questions');
    if (q.deja_fait) {
      const ok = Math.min(q.deja_fait.bonnes_reponses, q.questions.length);
      await must(sb.from('quiz_attempts').insert({
        quiz_id: quiz.id, user_id: uid, started_at: ago(1.01), completed_at: ago(1),
        score: ok, max_score: q.questions.length, correct_count: ok, total_count: q.questions.length,
        duration_seconds: 95, xp_awarded: ok * 10,
      }), 'Résultat du quiz');
    }
  }
  console.log(`  ✓ ${demo.quiz.length} quiz`);

  // 7. Les XP (classement, niveau)
  const prof = await must(sb.from('profiles').select('xp').eq('id', uid).single(), 'Lecture des XP');
  const missing = p.xp - (prof.xp || 0);
  if (missing > 0) await must(sb.rpc('add_xp', { p_user: uid, p_base: missing, p_reason: 'bonus', p_source: 'demo' }), 'XP');

  console.log(`\n  ✅ Compte prêt. Connecte-toi avec ${email} et le mot de passe de .env.local\n`);
}

main().catch((e) => stop(String(e?.message || e)));
