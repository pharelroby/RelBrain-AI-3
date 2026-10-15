/* POST /api/contact — formulaire de contact, support, bug report, suggestion.
   Anti-spam : champ piège « website » + 5 messages / heure / IP.
   Enregistré dans contact_messages ; copie email à SUPPORT_EMAIL si configuré. */
import { z } from 'zod';
import { route, parse, bearer } from '../lib/http';
import { admin, userFromJwt } from '../lib/supabase';
import { sendEmail, emailLayout, escapeHtml } from '../lib/notify';

const Body = z.object({
  name: z.string().trim().min(1, 'requis').max(120),
  email: z.string().trim().email('email invalide').max(254),
  topic: z.enum(['contact', 'support', 'bug', 'feature', 'partnership', 'press', 'privacy']).default('contact'),
  subject: z.string().trim().max(200).optional(),
  message: z.string().trim().min(10, '10 caractères minimum').max(5000),
  page_url: z.string().max(500).optional(),
  website: z.string().max(0).optional(), // champ piège : doit rester vide
});

const TOPICS: Record<string, string> = {
  contact: 'Contact', support: 'Support', bug: 'Bug', feature: 'Suggestion', partnership: 'Partenariat', press: 'Presse', privacy: 'Données personnelles',
};

export default route(
  { methods: ['POST'], rateLimit: { key: (c) => `contact:${c.ip}`, max: 5, windowSec: 3600 } },
  async ({ req }) => {
    const raw = (req.body || {}) as Record<string, unknown>;
    if (raw.website) return { ok: true }; // robot : on fait semblant
    const body = parse(Body, raw);
    const jwt = bearer(req);
    const user = jwt ? await userFromJwt(jwt) : null;

    await admin().from('contact_messages').insert({
      user_id: user?.id || null,
      name: body.name,
      email: body.email,
      topic: body.topic,
      subject: body.subject || null,
      message: body.message,
      page_url: body.page_url || null,
      user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
    });

    if (process.env.SUPPORT_EMAIL) {
      await sendEmail({
        to: process.env.SUPPORT_EMAIL,
        replyTo: body.email,
        subject: `[${TOPICS[body.topic]}] ${body.subject || body.message.slice(0, 60)}`,
        html: emailLayout({
          title: `${TOPICS[body.topic]} — ${escapeHtml(body.name)}`,
          intro: `<strong>${escapeHtml(body.email)}</strong>${user ? ' (compte connecté)' : ''}<br/><br/>${escapeHtml(body.message).replace(/\n/g, '<br/>')}`,
          footer: `Page : ${escapeHtml(body.page_url || '—')}`,
        }),
      });
    }
    return { ok: true, message: 'Message reçu ! Notre équipe te répond sous 24 à 48 h ouvrées.' };
  },
);
