/* POST /api/auth/recover — envoie le lien de réinitialisation du mot de passe.
   Réponse identique que le compte existe ou non (pas d'énumération d'emails). */
import { z } from 'zod';
import { route, parse } from '../../lib/http';
import { anon } from '../../lib/supabase';
import { hit } from '../../lib/rate-limit';
import { appUrl } from '../../lib/env';

const Body = z.object({ email: z.string().email().max(254) });

export default route(
  { methods: ['POST'], rateLimit: { key: (c) => `recover:ip:${c.ip}`, max: 5, windowSec: 3600 } },
  async ({ req }) => {
    const { email } = parse(Body, req.body);
    if (await hit(`recover:email:${email.toLowerCase()}`, 3, 3600)) {
      await anon().auth.resetPasswordForEmail(email.toLowerCase(), {
        redirectTo: `${appUrl()}/relbrain-reset-password.html`,
      });
    }
    return { ok: true, message: 'Si un compte existe pour cette adresse, un lien de réinitialisation vient d\'être envoyé.' };
  },
);
