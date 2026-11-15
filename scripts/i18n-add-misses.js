/* Ajoute à i18n/misses.json des textes repérés « non traduits » en naviguant en anglais.
   Dans la console du navigateur (site en anglais) :  copy(JSON.stringify(RB_I18N.misses()))
   puis :  node scripts/i18n-add-misses.js fichier.json   et enfin :  npm run i18n          */
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'i18n', 'misses.json');
const EN = path.join(__dirname, '..', 'i18n', 'en.json');
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const list = Array.isArray(input) ? input : Object.values(input).flat();
const english = new Set(Object.values(JSON.parse(fs.readFileSync(EN, 'utf8')).d));
const known = new Set(fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : []);
let added = 0;
for (let t of list) {
  t = String(t).replace(/\s+/g, ' ').trim();
  if (!/[A-Za-zÀ-ÿ]{2}/.test(t) || english.has(t)) continue;
  let n = 0;
  const k = t.replace(/\d+(?:[   .,]\d+)*/g, () => '{' + n++ + '}');
  for (const v of n ? [k] : [t]) if (!known.has(v)) { known.add(v); added++; }
}
fs.writeFileSync(OUT, JSON.stringify([...known].sort(), null, 1) + '\n');
console.log(`  ✓ ${added} textes ajoutés à i18n/misses.json (${known.size} au total)`);
