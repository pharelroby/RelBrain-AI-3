/* ═══════════════════════════════════════════════════════════════════════════
   RELBRAIN — serveur local complet : pages + fonctions /api, sans compte Vercel.
   Lance avec : npm run dev   (ou double-clic sur LANCER-RELBRAIN.bat)
   Il redémarre tout seul dès que tu enregistres .env.local.
   ═══════════════════════════════════════════════════════════════════════════ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

/* Processus superviseur : relance le serveur à chaque enregistrement de .env.local */
if (!process.env.RB_DEV_CHILD) {
  let child: ChildProcess;
  const start = () => {
    child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, RB_DEV_CHILD: '1' } });
  };
  start();
  fs.watchFile(path.join(ROOT, '.env.local'), { interval: 800 }, () => {
    console.log('\n  🔄 .env.local modifié : redémarrage…');
    child.once('exit', start);
    child.kill();
  });
  const stop = () => { child.kill(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} else {

function loadEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
}
loadEnv(path.join(ROOT, '.env.local'));

const PORT = Number(process.env.PORT || 3005);
process.env.APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function sendFile(res: http.ServerResponse, file: string, status = 200) {
  res.writeHead(status, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

function isFile(p: string) { try { return fs.statSync(p).isFile(); } catch { return false; } }

function serveStatic(pathname: string, res: http.ServerResponse) {
  const rel = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const file = path.join(ROOT, rel || 'index.html');
  const blocked = rel.startsWith('.') || /^(node_modules|lib|api|server|scripts|supabase|content[/\\]demo)([/\\]|$)/.test(rel) || !file.startsWith(ROOT);
  if (!blocked && isFile(file)) return sendFile(res, file);
  if (!blocked && isFile(file + '.html')) return sendFile(res, file + '.html');
  return sendFile(res, path.join(ROOT, '404.html'), 404);
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/* Reproduit l'interface req/res des fonctions Vercel utilisée par lib/http.ts.
   Comme en ligne, tout passe par l'aiguilleur api/router.ts. */
async function serveApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const name = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  const r = res as any;
  r.status = (c: number) => { res.statusCode = c; return r; };
  r.json = (o: unknown) => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return r; };
  r.send = (b: any) => { res.end(b); return r; };
  const router: any = await import(pathToFileURL(path.join(ROOT, 'api', 'router.ts')).href);
  const ROUTES = router.ROUTES ?? router.default?.ROUTES;
  const run = router.default?.default ?? router.default;
  const q = req as any;
  q.query = { ...Object.fromEntries(url.searchParams), __route: name };
  // Corps JSON déjà lu, sauf pour les routes qui veulent le corps brut (webhook Stripe)
  const load = Object.prototype.hasOwnProperty.call(ROUTES, name) ? ROUTES[name] : null;
  const mod: any = load ? await load() : null;
  const noParse = (mod?.config ?? mod?.default?.config)?.api?.bodyParser === false;
  if (mod && !noParse && !['GET', 'HEAD', 'OPTIONS'].includes(req.method || '')) {
    const raw = await readBody(req);
    try { q.body = raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch { q.body = {}; }
  }
  await run(q, r);
}

http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    serveApi(req, res, url).catch((err) => {
      console.error('[dev]', err);
      if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); }
      res.end(JSON.stringify({ error: { code: 'dev_error', message: String(err?.message || err) } }));
    });
    return;
  }
  serveStatic(url.pathname, res);
}).listen(PORT, '127.0.0.1', () => {
  const gemini = process.env.GEMINI_API_KEY, openai = process.env.OPENAI_API_KEY;
  console.log(`\n  🧠 RelBrain tourne sur http://localhost:${PORT}\n`);
  console.log(gemini ? `  ✅ IA : Gemini (${process.env.GEMINI_MODEL || 'modèle par défaut'})`
    : openai ? '  ✅ IA : OpenAI'
    : '  ⚠️  IA : aucune clé. Colle ta clé dans .env.local, ligne GEMINI_API_KEY=');
  console.log(process.env.SUPABASE_SERVICE_ROLE_KEY ? '  ✅ Supabase : clé serveur présente\n' : '  ⚠️  Supabase : SUPABASE_SERVICE_ROLE_KEY manquante dans .env.local\n');
});
}
