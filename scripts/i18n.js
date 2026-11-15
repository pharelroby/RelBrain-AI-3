/* ═══════════════════════════════════════════════════════════════════════════
   GÉNÈRE LA TRADUCTION ANGLAISE DU SITE  →  i18n/en.json
   Lance :  npm run i18n
   1. Relit toutes les pages (.html) et les scripts (.js) et relève chaque texte
      affiché en français (y compris les messages créés par les scripts).
   2. Ne traduit que les textes nouveaux (les anciennes traductions sont gardées)
      avec Gemini (GEMINI_API_KEY de .env.local).
   3. i18n/en.manual.json : tes corrections à la main, elles gagnent toujours.
   4. i18n/misses.json : textes repérés « non traduits » en naviguant (facultatif).
   Options :  --dry (liste sans traduire)   --stats   --prune (retire les textes disparus)
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseHTML } = require('linkedom');
const I = require('../relbrain-i18n.js');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'i18n', 'en.json');
const MANUAL = path.join(ROOT, 'i18n', 'en.manual.json');
const MISSES = path.join(ROOT, 'i18n', 'misses.json');
const args = process.argv.slice(2);
const SKIP_PAGES = new Set(['relbrain-design-system.html']);
const SKIP_JS = new Set(['relbrain-i18n.js', 'sw.js', 'relbrain-loader.js']);

const keys = new Set();
const prefixes = new Set();
const { LETTERS, norm } = I;

/* ─── Relevé dans un morceau de DOM (même logique que dans le navigateur) ─── */
function collect(node) {
  if (!node) return;
  if (node.nodeType === 3) {
    const t = norm(node.nodeValue || '');
    if (LETTERS.test(t)) keys.add(t);
    return;
  }
  if (node.nodeType !== 1) return;
  if (I.skipped(node)) return;
  for (const a of I.ATTRS) { const v = node.getAttribute(a); if (v && LETTERS.test(v)) keys.add(norm(v)); }
  if (I.isUnit(node)) {
    const u = I.unitParts(node);
    keys.add(u.key);
    // et chaque morceau seul, au cas où la phrase est reconstruite autrement par un script
    u.parts.forEach((p) => { const t = norm(p.textContent || ''); if (LETTERS.test(t)) keys.add(t); for (const a of I.ATTRS) { const v = p.getAttribute && p.getAttribute(a); if (v && LETTERS.test(v)) keys.add(norm(v)); } });
    return;
  }
  for (let c = node.firstChild; c; c = c.nextSibling) collect(c);
}
function collectHtml(html) {
  const { document } = parseHTML('<!doctype html><html><body><div id="x">' + html + '</div></body></html>');
  collect(document.getElementById('x'));
}

/* ─── Chaînes de caractères dans le code JavaScript ─── */
function literals(code) {
  const out = [];
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    if (c === '/' && code[i + 1] === '/') { while (i < n && code[i] !== '\n') i++; continue; }
    if (c === '/' && code[i + 1] === '*') { const e = code.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1, s = '', depth = 0;
      while (j < n) {
        const d = code[j];
        if (d === '\\') { const e = code[j + 1]; s += e === 'n' ? '\n' : e === 't' ? ' ' : e === 'u' ? String.fromCharCode(parseInt(code.substr(j + 2, 4), 16)) : e; j += e === 'u' ? 6 : 2; continue; }
        if (c === '`' && d === '$' && code[j + 1] === '{') {
          // ${ … } → {n}
          let k = j + 2; depth = 1;
          while (k < n && depth) { if (code[k] === '{') depth++; else if (code[k] === '}') depth--; k++; }
          s += '\u0000'; j = k; continue;
        }
        if (d === c) break;
        if (d === '\n' && c !== '`') break;
        s += d; j++;
      }
      out.push({ q: c, s });
      i = j + 1; continue;
    }
    i++;
  }
  return out;
}
const CODEY = /function\s*\(|=>|\);|^\s*[.#[]|fa-solid|fa-regular|^rb-|^https?:|^\/|\.html|\.js$|px\b|rgba?\(|var\(--|^[a-z0-9_\-.:\/#?=&%]+$/;
function takeLiteral(raw) {
  let s = raw.s;
  if (!s || s.length < 2 || s.length > 1200) return;
  if (!/[A-Za-zÀ-ÿ]{2}/.test(s)) return;
  let k = 0;
  s = s.replace(/\u0000/g, () => '{' + k++ + '}');
  if (/<[a-z]/i.test(s) && />/.test(s)) {
    // morceau de HTML : on le lit comme une page (en remplaçant les {n} par du texte neutre)
    collectHtml(s);
    return;
  }
  if (/[<>]/.test(s)) return;
  const t = norm(s);
  if (!LETTERS.test(t) || CODEY.test(t)) return;
  const french = /[àâçéèêëîïôûùüœ]/i.test(t) || / /.test(t) || /^[A-ZÀ-Ý][a-zà-ÿ]+$/.test(t);
  if (!french) return;
  if (/^[A-Za-z]+[A-Z][a-z]/.test(t) && !/ /.test(t)) return; // camelCase
  keys.add(t);
  if (/(\s|:\s?)$/.test(s) && t.split(' ').length <= 4 && !/\{\d+\}/.test(t)) prefixes.add(t);
}

/* ─── Messages d'erreur du serveur (HttpError) ─── */
function serverMessages(code) {
  const re = /HttpError\(\s*\d+\s*,\s*['"`][^'"`]*['"`]\s*,\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  let m;
  while ((m = re.exec(code))) takeLiteral({ q: m[1], s: m[2].replace(/\\(.)/g, '$1').replace(/\$\{[^}]*\}/g, '\u0000') });
}
function walkDir(dir, ext, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name !== 'node_modules') walkDir(p, ext, out); }
    else if (f.name.endsWith(ext)) out.push(p);
  }
  return out;
}

function scan() {
  for (const f of fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && !SKIP_PAGES.has(f))) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const { document } = parseHTML(src);
    const title = document.querySelector('title');
    if (title && LETTERS.test(title.textContent)) keys.add(norm(title.textContent));
    collect(document.body);
    for (const s of document.querySelectorAll('script:not([src])')) literals(s.textContent).forEach(takeLiteral);
    // gestionnaires onclick="toast('…')"
    for (const el of document.querySelectorAll('[onclick],[oninput],[onchange]')) for (const a of ['onclick', 'oninput', 'onchange']) { const v = el.getAttribute(a); if (v) literals(v).forEach(takeLiteral); }
  }
  for (const f of fs.readdirSync(ROOT).filter((f) => f.endsWith('.js') && !SKIP_JS.has(f))) literals(fs.readFileSync(path.join(ROOT, f), 'utf8')).forEach(takeLiteral);
  for (const f of [...walkDir(path.join(ROOT, 'server'), '.ts'), ...walkDir(path.join(ROOT, 'lib'), '.ts')]) {
    if (/prompt/i.test(f)) continue;
    serverMessages(fs.readFileSync(f, 'utf8'));
  }
  if (fs.existsSync(MISSES)) JSON.parse(fs.readFileSync(MISSES, 'utf8')).forEach((t) => { t = norm(t); if (LETTERS.test(t)) keys.add(t); });
  // Restes de HTML découpé par les scripts : inutiles
  for (const k of [...keys]) if (/="|">|^["'%,;)\-]|#[0-9a-f]{3,6}\b|\b\d+px\b|^-?\d{3}\b|\b(text|bg|border)-[a-z]+-\d{2,3}\b|^\W*\d*\W*$/i.test(k)) keys.delete(k);
  // Les marques et sigles seuls n'ont pas besoin de traduction
  for (const k of [...keys]) if (/^(RelBrain(\.AI)?|XP|SM-2|GCE|BEPC|FCFA|IA|AI|PDF|OK|QCM)$/i.test(k)) keys.delete(k);
}

/* ─── Traduction avec Gemini ─── */
function env() {
  const e = {};
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) e[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (x) {}
  return { ...e, ...process.env };
}
const RULES = `You translate the French user interface of RelBrain, a study-coach web app for secondary-school and university students in Cameroon and the rest of Africa, into natural, friendly English (the English used by Cameroonian anglophone students preparing the GCE).
Rules:
- Address the user informally as "you". Keep the tone warm, short and clear, like the French.
- Keep EXACTLY every placeholder: <0>…</0>, <1/>, {0}, {1}… (same numbers, may be reordered to fit English grammar). Never add or drop one.
- Keep emoji, numbers, symbols, prices ("3 000 F", "FCFA"), arrows and punctuation marks like "→", "·", "…".
- Do not translate brand or proper names: RelBrain, RelBrain.AI, XP, SM-2, school and university names, city names, people's names.
- Exam names: "Baccalauréat"/"Bac" → "Baccalaureate"/"Bac", "Probatoire" stays "Probatoire", "BEPC" stays, "GCE O & A Level" stays, "concours" → "entrance exam(s)", "annales" → "past papers", "épreuve" → "paper", "corrigé" → "answer key", "Licence" → "Bachelor's", "classes prépa" → "preparatory classes".
- Ligue names: Bronze, Argent → Silver, Or → Gold, Platine → Platinum, Diamant → Diamond, Maître → Master.
- "Flashcards", "quiz" stay. "Tableau de bord" → "Dashboard". "Salle des profs" → "Staff room". "Série" (streak) → "streak".
- If the text is already English or is code/an identifier, return it unchanged.
Return a JSON object mapping each input id to its translation.`;

let MODEL = null;
async function gemini(batch, e) {
  MODEL = MODEL || e.I18N_MODEL || e.GEMINI_MODEL || 'gemini-2.5-flash';
  const body = {
    systemInstruction: { parts: [{ text: RULES }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(batch.map((t, i) => ({ id: String(i), fr: t }))) }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
  };
  for (let attempt = 0; attempt < 10; attempt++) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${e.GEMINI_API_KEY}`;
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 429 || r.status >= 500) {
      // Quota gratuit : on attend le délai indiqué par Google avant de réessayer
      const t = await r.text();
      // Quota du jour épuisé sur ce modèle : on passe au modèle de secours
      if (/PerDay|per day|free_tier_requests/i.test(t) && e.GEMINI_FALLBACK_MODEL && MODEL !== e.GEMINI_FALLBACK_MODEL) { console.warn('  ↪ quota du jour atteint, modèle de secours : ' + e.GEMINI_FALLBACK_MODEL); MODEL = e.GEMINI_FALLBACK_MODEL; continue; }
      const m = t.match(/"retryDelay":\s*"(\d+)/);
      await new Promise((ok) => setTimeout(ok, (m ? +m[1] + 2 : 15 * (attempt + 1)) * 1000));
      continue;
    }
    if (!r.ok) throw new Error('Gemini ' + r.status + ' ' + (await r.text()).slice(0, 300));
    const j = await r.json();
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '{}';
    try { return JSON.parse(text); } catch (x) { if (attempt === 9) throw x; }
  }
  throw new Error('Gemini : trop de tentatives');
}
function sameTags(a, b) {
  const sig = (s) => (s.match(/<\d+\/>|<\d+>|<\/\d+>|\{\d+\}/g) || []).sort().join(',');
  return sig(a) === sig(b);
}

(async () => {
  scan();
  const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { d: {} };
  const manual = fs.existsSync(MANUAL) ? JSON.parse(fs.readFileSync(MANUAL, 'utf8')) : {};
  const d = args.includes('--prune') ? {} : { ...old.d };
  if (args.includes('--prune')) for (const k of keys) if (old.d[k] != null) d[k] = old.d[k];
  const todo = [...keys].filter((k) => d[k] == null && manual[k] == null);
  console.log(`  ${keys.size} textes relevés · ${todo.length} à traduire · ${prefixes.size} débuts de phrase`);
  if (args.includes('--dry') || args.includes('--stats')) { if (args.includes('--dry')) console.log(todo.slice(0, 200).join('\n')); return; }

  const e = env();
  if (todo.length && !e.GEMINI_API_KEY) { console.error('  ✗ GEMINI_API_KEY manquante dans .env.local'); process.exit(1); }
  const SIZE = Number(process.env.I18N_BATCH || 150), batches = [];
  for (let i = 0; i < todo.length; i += SIZE) batches.push(todo.slice(i, i + SIZE));
  let done = 0, bad = 0;
  const save = () => {
    const merged = { ...d, ...manual };
    const v = crypto.createHash('sha1').update(JSON.stringify(merged)).digest('hex').slice(0, 10);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    const pre = [...prefixes].filter((p) => merged[p] != null);
    fs.writeFileSync(OUT, JSON.stringify({ v, d: merged, p: pre }) + '\n');
    const js = path.join(ROOT, 'relbrain-i18n.js');
    fs.writeFileSync(js, fs.readFileSync(js, 'utf8').replace(/var VERSION = '[^']*';/, `var VERSION = '${v}';`));
    return v;
  };
  const queue = batches.slice();
  async function worker() {
    while (queue.length) {
      const b = queue.shift();
      try {
        const res = await gemini(b, e);
        b.forEach((fr, i) => { const en = res[String(i)]; if (typeof en === 'string' && en.trim() && sameTags(fr, en)) d[fr] = en; else bad++; });
      } catch (x) { console.warn('  ! lot ignoré : ' + x.message); bad += b.length; }
      done += b.length;
      process.stdout.write(`\r  … ${done}/${todo.length} traduits`);
      save();
    }
  }
  await Promise.all(Array.from({ length: Number(process.env.I18N_WORKERS || 1) }, worker));
  const v = save();
  console.log(`\n  ✓ i18n/en.json (version ${v})${bad ? ' · ' + bad + ' textes à revoir (relance npm run i18n)' : ''}`);
})();
