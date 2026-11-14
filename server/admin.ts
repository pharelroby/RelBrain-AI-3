/* POST /api/admin?action=status|test|ocr — outils serveur de la page administrateur.
   Une seule fonction pour tout l'admin ; le reste passe par les RPC admin_* (0009). */
import { z } from 'zod';
import { route, parse, HttpError } from '../lib/http';
import { admin } from '../lib/supabase';
import { PROVIDER, MODELS, openai, ocrImage, chatExtras, toHttpError } from '../lib/ai/openai';

const Ocr = z.object({ image: z.string().min(100).max(5_000_000) });

export default route({ methods: ['POST'], auth: true }, async ({ req, user }) => {
  const { data } = await admin().from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
  if (!data?.is_admin) throw new HttpError(403, 'forbidden', 'Accès réservé aux administrateurs.');

  const action = String(req.query.action || '');
  if (action === 'status') return { provider: PROVIDER, model: PROVIDER ? MODELS.main : null, service_key: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) };

  if (action === 'test') {
    if (!PROVIDER) throw new HttpError(503, 'ai_not_configured', 'Aucune clé IA : colle ta clé dans .env.local.');
    try {
      const r = await openai().chat.completions.create({ model: MODELS.main, max_tokens: 400, ...chatExtras, messages: [{ role: 'user', content: 'Réponds uniquement : OK' }] });
      return { ok: true, model: MODELS.main, reply: r.choices[0]?.message?.content?.trim() || '' };
    } catch (err) {
      throw toHttpError(err);
    }
  }

  if (action === 'ocr') {
    const { image } = parse(Ocr, req.body);
    return { text: await ocrImage(Buffer.from(image, 'base64'), 'image/jpeg', user.id) };
  }

  throw new HttpError(400, 'unknown_action', 'Action inconnue.');
});
