/* POST /api/auth/resend — renvoie l'email de confirmation d'inscription (3 / heure). */
import { z } from 'zod';
import { route, parse } from '../../lib/http';
import { anon } from '../../lib/supabase';
import { hit } from '../../lib/rate-limit';
import { appUrl } from '../../lib/env';

const Body = z.object({ email: z.string().email().max(254) });

export default route(
  { methods: ['POST'], rateLimit: { key: (c) => `resend:ip:${c.ip}`, max: 6, windowSec: 3600 } },
  async ({ req }) => {
    const { email } = parse(Body, req.body);
    if (await hit(`resend:email:${email.toLowerCase()}`, 3, 3600)) {
      await anon().auth.resend({
        type: 'signup',
        email: email.toLowerCase(),
        options: { emailRedirectTo: `${appUrl()}/relbrain-validation-email.html?confirmed=1` },
      });
    }
    return { ok: true };
  },
);
