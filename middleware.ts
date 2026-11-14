/* ═══════════════════════════════════════════════════════════════════════════
   Protection des pages privées (Vercel Routing Middleware, exécuté en edge).
   Le navigateur conserve le jeton d'accès Supabase dans le cookie « rb-at »
   (posé par relbrain-app.js). Sans jeton valide → redirection vers la
   connexion avec ?next=… pour revenir ensuite à la bonne page.

   Note : un jeton expiré mais correctement signé est accepté (tolérance
   7 jours) : le client le rafraîchit automatiquement au chargement. La
   vraie barrière de sécurité reste RLS : sans session valide, la base ne
   renvoie aucune donnée.
   ═══════════════════════════════════════════════════════════════════════════ */
import { next } from '@vercel/edge';
import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader } from 'jose';

export const config = {
  matcher: [
    '/dashboard', '/dashboard.html',
    '/relbrain-accueil', '/relbrain-accueil.html',
    '/relbrain-documents', '/relbrain-documents.html',
    '/relbrain-quiz-setup', '/relbrain-quiz-setup.html',
    '/relbrain-quiz-interface', '/relbrain-quiz-interface.html',
    '/relbrain-flashcards', '/relbrain-flashcards.html',
    '/relbrain-classement', '/relbrain-classement.html',
    '/relbrain-concours', '/relbrain-concours.html',
    '/relbrain-profil', '/relbrain-profil.html',
    '/relbrain-parametres', '/relbrain-parametres.html',
    '/relbrain-admin', '/relbrain-admin.html',
    // Code source et données internes : jamais servis aux visiteurs
    '/server/:path*', '/lib/:path*', '/scripts/:path*', '/supabase/:path*', '/content/demo/:path*',
  ],
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie') || '';
  const match = header.split(/;\s*/).find((c) => c.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export default async function middleware(request: Request) {
  if (/^\/(server|lib|scripts|supabase|content\/demo)(\/|$)/.test(new URL(request.url).pathname)) {
    return new Response('Page introuvable', { status: 404 });
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  // Mode démo : backend non configuré → les maquettes restent accessibles
  if (!supabaseUrl) return next();

  const url = new URL(request.url);
  const toLogin = () => {
    const login = new URL('/relbrain-login.html', url);
    login.searchParams.set('next', url.pathname + url.search);
    return Response.redirect(login, 307);
  };

  const token = readCookie(request, 'rb-at');
  if (!token) return toLogin();

  try {
    // ═══════════════════════════════════════════════════════════════
    // 🔑 VÉRIFICATION DES JETONS
    // ────────────────────────────────────────────────────────────────
    // · Projets Supabase récents (clés de signature asymétriques) :
    //   rien à faire, la clé publique est lue sur /auth/v1/.well-known/jwks.json
    // · Projets plus anciens (secret partagé HS256) : ajoute
    //   SUPABASE_JWT_SECRET=… (Supabase → Project Settings → API → JWT Secret)
    // ═══════════════════════════════════════════════════════════════
    const secret = process.env.SUPABASE_JWT_SECRET; // ⬅️ LE SECRET JWT EST ICI (optionnel)
    const options = { clockTolerance: 7 * 24 * 3600 };
    // On regarde comment le jeton est signé : le secret partagé ne sert qu'aux jetons HS256.
    // Les projets récents signent en ES256/RS256 : vérification par la clé publique (JWKS).
    const alg = String(decodeProtectedHeader(token).alg || '');
    if (secret && alg.startsWith('HS')) {
      await jwtVerify(token, new TextEncoder().encode(secret), options);
    } else {
      jwks = jwks || createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', supabaseUrl));
      await jwtVerify(token, jwks, options);
    }
    return next();
  } catch {
    return toLogin();
  }
}
