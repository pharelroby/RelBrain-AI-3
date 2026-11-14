/* ═══════════════════════════════════════════════════════════════════════════
   GÉNÈRE TOUTES LES ICÔNES DE RELBRAIN depuis brand/icon-master.svg
   Lance :  npm run icons
   Produit : apple-touch-icon.png (iPhone / iPad), icon-192.png, icon-512.png,
             icon-maskable-512.png (Android), favicon-32.png et icon.svg (navigateurs).
   Pour changer le logo : modifie brand/icon-master.svg puis relance la commande.
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const ROOT = path.resolve(__dirname, '..');
const svg = fs.readFileSync(path.join(ROOT, 'brand', 'icon-master.svg'), 'utf8');

const SORTIES = [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],
  ['favicon-32.png', 32],
];
for (const [file, size] of SORTIES) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size }, background: '#7c3aed' }).render().asPng();
  fs.writeFileSync(path.join(ROOT, file), png);
  console.log('  ✓ ' + file.padEnd(24) + size + ' × ' + size + '  (' + Math.round(png.length / 1024) + ' Ko)');
}

// icon.svg : le même dessin, coins arrondis pour l'onglet du navigateur
const rounded = svg
  .replace('<rect width="1024" height="1024" fill="url(#bg)"/>', '<clipPath id="r"><rect width="1024" height="1024" rx="230"/></clipPath><g clip-path="url(#r)"><rect width="1024" height="1024" fill="url(#bg)"/>')
  .replace('</svg>', '</g></svg>')
  .replace(/<!--[\s\S]*?-->/g, '');
fs.writeFileSync(path.join(ROOT, 'icon.svg'), rounded);
console.log('  ✓ icon.svg (onglet du navigateur)\n');
