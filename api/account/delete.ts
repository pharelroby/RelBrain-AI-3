/* POST /api/account/delete { confirm: "SUPPRIMER" }
   Droit à l'effacement (RGPD / loi camerounaise n° 2024/017) :
   supprime les fichiers (documents, avatar) puis le compte Auth ; toutes les
   tables liées sont effacées en cascade (ON DELETE CASCADE).            */
import { z } from 'zod';
import { route, parse, HttpError } from '../../lib/http';
import { admin } from '../../lib/supabase';

async function removeFolder(bucket: string, prefix: string) {
  const sb = admin();
  for (let round = 0; round < 50; round++) {
    const { data } = await sb.storage.from(bucket).list(prefix, { limit: 100 });
    if (!data || !data.length) return;
    await sb.storage.from(bucket).remove(data.map((f) => `${prefix}/${f.name}`));
  }
}

export default route(
  { methods: ['POST'], auth: true, rateLimit: { key: (c) => `delete:${c.user!.id}`, max: 3, windowSec: 3600 } },
  async ({ req, user }) => {
    parse(z.object({ confirm: z.literal('SUPPRIMER') }), req.body);
    await removeFolder('documents', user.id);
    await removeFolder('avatars', user.id);
    const { error } = await admin().auth.admin.deleteUser(user.id);
    if (error) throw new HttpError(500, 'delete_failed', 'La suppression a échoué. Contacte privacy@relbrain.ai si le problème persiste.');
    return { ok: true };
  },
);
