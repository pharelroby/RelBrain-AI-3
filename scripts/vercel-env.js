/* ═══════════════════════════════════════════════════════════════════════════
   ENVOYER TES CLÉS À VERCEL
   ───────────────────────────────────────────────────────────────────────────
   Lance :  npm run vercel:env
   Le script lit .env.local et envoie à Vercel (environnement « production »)
   les variables utiles au site en ligne. Aucune valeur n'est affichée.
   Relance-le après avoir changé une clé dans .env.local, puis :  npm run deploy

   ➕ Pour envoyer une autre variable : ajoute son nom dans la liste A_ENVOYER.
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const A_ENVOYER = [
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET',
  'GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_FALLBACK_MODEL', 'GEMINI_EMBEDDING_MODEL',
  'CRON_SECRET', 'PAYMENTS_ENABLED', 'REMINDERS_HOURLY',
  'RESEND_API_KEY', 'EMAIL_FROM', 'SUPPORT_EMAIL',
  'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT',
];

const ROOT = path.resolve(__dirname, '..');
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
}
// APP_URL n'est envoyée que si c'est une vraie adresse (sinon Vercel fournit la sienne automatiquement)
if (env.APP_URL && !/localhost|127\.0\.0\.1/.test(env.APP_URL)) A_ENVOYER.push('APP_URL');

const bin = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'vercel.cmd' : 'vercel');
const run = (args, input) => spawnSync(bin, args, { cwd: ROOT, input, encoding: 'utf8', shell: process.platform === 'win32' });

console.log('\n  🔑 Envoi des clés à Vercel (production)…\n');
let ok = 0, ko = 0, vide = [];
for (const name of A_ENVOYER) {
  const value = env[name];
  if (!value) { vide.push(name); continue; }
  run(['env', 'rm', name, 'production', '--yes']); // remplace l'ancienne valeur si elle existe
  const r = run(['env', 'add', name, 'production'], value);
  if (r.status === 0) { ok++; console.log('  ✓ ' + name); }
  else {
    ko++;
    const msg = String(r.stderr || r.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean).pop() || 'erreur';
    console.log('  ✗ ' + name + ' → ' + msg.split(value).join('•••'));
  }
}
if (vide.length) console.log('\n  (vides dans .env.local, non envoyées : ' + vide.join(', ') + ')');
console.log(`\n  ${ok} clé(s) envoyée(s)${ko ? `, ${ko} en erreur` : ''}. Étape suivante : npm run deploy\n`);
process.exit(ko ? 1 : 0);
