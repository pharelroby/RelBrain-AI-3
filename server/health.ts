/* GET /api/health — indique quelles intégrations sont configurées
   (sans jamais révéler la valeur des clés). Pratique après un déploiement. */
import { route } from '../lib/http';

const has = (k: string) => Boolean(process.env[k]);

export default route({ methods: ['GET'] }, async () => ({
  status: 'ok',
  time: new Date().toISOString(),
  integrations: {
    supabase: has('SUPABASE_URL') && has('SUPABASE_ANON_KEY') && has('SUPABASE_SERVICE_ROLE_KEY'),
    ai: has('GEMINI_API_KEY') ? 'gemini' : has('OPENAI_API_KEY') ? 'openai' : false,
    push: has('VAPID_PUBLIC_KEY') && has('VAPID_PRIVATE_KEY'),
    email: has('RESEND_API_KEY'),
    stripe: has('STRIPE_SECRET_KEY') && has('STRIPE_WEBHOOK_SECRET'),
    mtn_momo: has('MTN_MOMO_SUBSCRIPTION_KEY') && has('MTN_MOMO_API_USER') && has('MTN_MOMO_API_KEY'),
    orange_money: has('ORANGE_MONEY_AUTH_HEADER') && has('ORANGE_MONEY_MERCHANT_KEY'),
    cron: has('CRON_SECRET'),
  },
}));
