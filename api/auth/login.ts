/* POST /api/auth/login — connexion email + mot de passe.
   Limites : 10 essais / 15 min par IP et 5 / 15 min par adresse email.
   Renvoie les jetons ; le navigateur appelle supabase.auth.setSession(). */
import { z } from 'zod';
import { route, parse, HttpError } from '../../lib/http';
import { anon } from '../../lib/supabase';
import { hit } from '../../lib/rate-limit';

const Body = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(72) });

export default route(
  { methods: ['POST'], rateLimit: { key: (c) => `login:ip:${c.ip}`, max: 10, windowSec: 900 } },
  async ({ req, res }) => {
    const body = parse(Body, req.body);
    const email = body.email.toLowerCase();
    if (!(await hit(`login:email:${email}`, 5, 900))) {
      res.setHeader('Retry-After', '900');
      throw new HttpError(429, 'rate_limited', 'Trop de tentatives pour ce compte. Réessaie dans 15 minutes ou réinitialise ton mot de passe.');
    }
    const { data, error } = await anon().auth.signInWithPassword({ email, password: body.password });
    if (error || !data.session) {
      if (error && /not confirmed/i.test(error.message)) {
        throw new HttpError(403, 'email_not_confirmed', "Ton adresse n'est pas encore validée. Clique sur le lien reçu par email (pense aux spams).");
      }
      // Message volontairement générique : on ne révèle pas si le compte existe
      throw new HttpError(401, 'invalid_credentials', 'Email ou mot de passe incorrect.');
    }
    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      user: { id: data.user.id, email: data.user.email },
    };
  },
);
