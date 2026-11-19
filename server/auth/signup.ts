/* POST /api/auth/signup — inscription email + mot de passe (limitée : 30 / heure / IP).

   ═══════════════════════════════════════════════════════════════
   📧 CONFIRMATION D'EMAIL — PHASE DE TEST
   ───────────────────────────────────────────────────────────────
   Le service d'emails gratuit de Supabase n'envoie que quelques
   emails par heure pour tout le projet : au-delà, chaque inscription
   échouait (« email rate limit exceeded »).
   Pendant la phase de test, le compte est donc créé DÉJÀ CONFIRMÉ,
   sans email, et l'élève est connecté tout de suite.
   Quand un vrai service d'emails sera branché (nom de domaine +
   SMTP dans Supabase), mets REQUIRE_EMAIL_CONFIRM=true dans Vercel :
   la confirmation par email reviendra.
   ═══════════════════════════════════════════════════════════════ */
import { z } from 'zod';
import { route, parse, HttpError } from '../../lib/http';
import { anon, admin } from '../../lib/supabase';
import { appUrl } from '../../lib/env';

const Body = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8, 'au moins 8 caractères').max(72),
  profile: z
    .object({
      first_name: z.string().max(60).optional(),
      last_name: z.string().max(60).optional(),
      phone: z.string().max(30).optional(),
      country: z.string().max(60).optional(),
      institution: z.string().max(120).optional(),
      school_level: z.enum(['college', 'lycee', 'bts', 'licence', 'master', 'prepa', 'autre']).optional(),
      field: z.string().max(120).optional(),
      language: z.enum(['fr', 'en']).optional(),
      goals: z.array(z.string().max(30)).max(10).optional(),
    })
    .default({}),
  // Pièges à robots : champ invisible (rempli = robot) et temps passé sur le formulaire (en ms)
  hp: z.string().max(200).optional(),
  t: z.number().int().nonnegative().optional(),
});

function signupError(message: string): never {
  if (/already registered|already exists|already been registered/i.test(message)) {
    throw new HttpError(409, 'email_taken', 'Un compte existe déjà avec cette adresse. Connecte-toi ou réinitialise ton mot de passe.');
  }
  if (/password/i.test(message)) throw new HttpError(400, 'weak_password', 'Mot de passe trop faible : 8 caractères minimum, avec lettres et chiffres.');
  throw new HttpError(400, 'signup_failed', "L'inscription n'a pas pu aboutir. Vérifie tes informations.");
}

export default route(
  { methods: ['POST'], rateLimit: { key: (c) => `signup:${c.ip}`, max: 30, windowSec: 3600 } },
  async ({ req }) => {
    const body = parse(Body, req.body);
    const email = body.email.toLowerCase();
    if (body.hp || (body.t !== undefined && body.t < 3000)) {
      // Robot probable : refus discret, sans dire pourquoi
      throw new HttpError(400, 'signup_failed', "L'inscription n'a pas pu aboutir. Réessaie dans un instant.");
    }

    // Phase de test : compte confirmé d'office, pas d'email envoyé
    if (process.env.REQUIRE_EMAIL_CONFIRM !== 'true') {
      const created = await admin().auth.admin.createUser({ email, password: body.password, email_confirm: true, user_metadata: body.profile });
      if (created.error) signupError(created.error.message);
      const { data, error } = await anon().auth.signInWithPassword({ email, password: body.password });
      if (error || !data.session) return { user_id: created.data.user?.id, needs_confirmation: false, session: null };
      return {
        user_id: data.user?.id,
        needs_confirmation: false,
        session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_at: data.session.expires_at },
      };
    }

    const { data, error } = await anon().auth.signUp({
      email,
      password: body.password,
      options: { data: body.profile, emailRedirectTo: `${appUrl()}/relbrain-validation-email.html?confirmed=1` },
    });
    if (error) signupError(error.message);
    return {
      user_id: data.user?.id,
      needs_confirmation: !data.session,
      session: data.session
        ? { access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_at: data.session.expires_at }
        : null,
    };
  },
);
