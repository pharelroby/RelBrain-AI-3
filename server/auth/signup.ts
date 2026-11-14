/* POST /api/auth/signup — inscription email + mot de passe (limitée : 5 / heure / IP).
   Supabase envoie l'email de confirmation ; le lien ramène sur relbrain-validation-email.html. */
import { z } from 'zod';
import { route, parse, HttpError } from '../../lib/http';
import { anon } from '../../lib/supabase';
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
});

export default route(
  { methods: ['POST'], rateLimit: { key: (c) => `signup:${c.ip}`, max: 5, windowSec: 3600 } },
  async ({ req }) => {
    const body = parse(Body, req.body);
    const { data, error } = await anon().auth.signUp({
      email: body.email.toLowerCase(),
      password: body.password,
      options: {
        data: body.profile,
        emailRedirectTo: `${appUrl()}/relbrain-validation-email.html?confirmed=1`,
      },
    });
    if (error) {
      if (/already registered|already exists/i.test(error.message)) {
        throw new HttpError(409, 'email_taken', 'Un compte existe déjà avec cette adresse. Connecte-toi ou réinitialise ton mot de passe.');
      }
      if (/password/i.test(error.message)) throw new HttpError(400, 'weak_password', 'Mot de passe trop faible : 8 caractères minimum, avec lettres et chiffres.');
      throw new HttpError(400, 'signup_failed', "L'inscription n'a pas pu aboutir. Vérifie tes informations.");
    }
    return {
      user_id: data.user?.id,
      needs_confirmation: !data.session,
      // Si la confirmation d'email est désactivée dans Supabase, une session est renvoyée directement.
      session: data.session
        ? { access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_at: data.session.expires_at }
        : null,
    };
  },
);
