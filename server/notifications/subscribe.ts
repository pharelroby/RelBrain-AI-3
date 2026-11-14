/* /api/notifications/subscribe
   GET    → clé publique VAPID (pour pushManager.subscribe)
   POST   → enregistre l'abonnement push de cet appareil
   DELETE → supprime l'abonnement (déconnexion / désactivation)        */
import { z } from 'zod';
import { route, parse, HttpError, bearer } from '../../lib/http';
import { admin, userFromJwt } from '../../lib/supabase';

const Sub = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});

export default route({ methods: ['GET', 'POST', 'DELETE'] }, async ({ req }) => {
  if (req.method === 'GET') {
    return { publicKey: process.env.VAPID_PUBLIC_KEY || null };
  }
  const jwt = bearer(req);
  const user = jwt ? await userFromJwt(jwt) : null;
  if (!user) throw new HttpError(401, 'unauthenticated', 'Connecte-toi pour activer les notifications.');

  if (req.method === 'POST') {
    const sub = parse(Sub, req.body);
    const { error } = await admin()
      .from('push_subscriptions')
      .upsert(
        { user_id: user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_agent: String(req.headers['user-agent'] || '').slice(0, 300) },
        { onConflict: 'endpoint' },
      );
    if (error) throw new HttpError(500, 'subscribe_failed', "Impossible d'activer les notifications sur cet appareil.");
    return { ok: true };
  }

  const { endpoint } = parse(z.object({ endpoint: z.string().url() }), req.body);
  await admin().from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', endpoint);
  return { ok: true };
});
