# RelBrain AI

> **Ton cerveau. Tes cours. Ton apprentissage.**
> Plateforme d'apprentissage qui transforme n'importe quel cours (PDF, Word, PowerPoint, photos de notes) en quiz, flashcards, fiches de révision et révisions espacées — pensée pour le Bac, le GCE, les concours et l'université en Afrique francophone.

---

## Sommaire

1. [Architecture](#1-architecture)
2. [Structure du projet](#2-structure-du-projet)
3. [Démarrage rapide (mode démo)](#3-démarrage-rapide-mode-démo)
4. [Mise en production pas à pas](#4-mise-en-production-pas-à-pas)
5. [Où insérer les clés API](#5-où-insérer-les-clés-api)
6. [Backend : ce qui est fait](#6-backend--ce-qui-est-fait)
7. [Design system « Cahier vivant »](#7-design-system--cahier-vivant-)
8. [Ajouter un article de blog](#8-ajouter-un-article-de-blog)
9. [Limites connues et prochaines étapes](#9-limites-connues-et-prochaines-étapes)

---

## 1. Architecture

Le projet existant était un ensemble de **pages HTML statiques** (Tailwind via CDN). Pour ne casser aucune page, il garde cette forme et reçoit un vrai backend :

```
Navigateur ──► Pages HTML (Tailwind + design system + relbrain-app.js)
   │                 │
   │                 ├── Supabase JS (session, lecture des données sous RLS, temps réel, stockage)
   │                 └── /api/*  ──► Fonctions serverless Vercel (TypeScript, Node 20)
   │                                   ├── OpenAI (analyse, quiz, flashcards, résumés, chat, OCR, embeddings)
   │                                   ├── Supabase (clé service_role, côté serveur uniquement)
   │                                   ├── Stripe · MTN MoMo · Orange Money
   │                                   └── Web Push (VAPID) · Resend (emails)
   └── middleware.ts (edge) : protège les pages privées
Supabase Postgres : tables + RLS + fonctions SQL (XP, séries, SM-2, ligues, défis, badges, quotas) + pg_cron
```

**Pourquoi pas Next.js ?** Le cahier des charges mentionne Next.js 15, mais le code existant est en HTML statique. Une migration aurait réécrit toutes les pages. L'architecture choisie reprend les mêmes briques (routes `/api/...` identiques à celles demandées, Supabase Auth/Storage/Postgres, OpenAI) et reste migrable vers Next.js plus tard : `lib/` et `api/` sont du TypeScript indépendant du framework.

**Mode démo.** Tant que `relbrain-config.js` ne contient pas de clés Supabase, toutes les pages fonctionnent avec leurs données d'exemple (aucun compte requis). Dès que les clés sont renseignées, les pages basculent automatiquement sur les vraies données.

---

## 2. Structure du projet

```
├── index.html                      Page d'accueil (refonte éditoriale)
├── relbrain-*.html                 Pages de l'application et du site (27 pages)
├── relbrain-design-system.css      ★ Design system : tokens, composants, animations (documenté)
├── relbrain-theme.css / relbrain-typography.css   Alias de compatibilité (importent le design system)
├── relbrain-motion.js              ★ Animations signature (RB.motion)
├── relbrain-theme.js               Thème clair/sombre + toasts (RB.toast)
├── relbrain-config.js              🔑 Clés PUBLIQUES (Supabase URL + anon key, VAPID)
├── relbrain-app.js                 ★ Client : auth, données, temps réel, notifications, célébrations
├── relbrain-site.js                En-tête / pied de page du site vitrine, sommaire automatique
├── sw.js · manifest.webmanifest · icon*.png/svg     PWA : hors-ligne léger + notifications push
├── content/blog/posts.json         Articles du blog (structure évolutive)
├── api/router.ts                   ★ L'aiguilleur : une seule fonction Vercel pour toutes les routes /api
├── server/                         ★ Les routes (appelées par api/router.ts)
│   ├── auth/        signup · login · recover · resend          (limitation de débit)
│   ├── documents/   process · delete                            (upload, extraction, RAG)
│   ├── ai/          analyze · quiz · flashcards · summary · chat (streaming)
│   ├── notifications/subscribe     (Web Push)
│   ├── payments/    checkout · status
│   ├── webhooks/    stripe · mobile-money
│   ├── cron/        notifications · subscriptions (une fois par jour)
│   ├── account/     export (RGPD) · delete
│   ├── keys.ts · v1/quizzes.ts     API publique (clés rb_live_…)
│   ├── contact.ts · health.ts
├── lib/                            Code serveur partagé (TypeScript)
│   ├── ai/openai.ts  ai/prompts.ts  ai/source.ts               🔑 OpenAI + prompt engineering
│   ├── supabase.ts · http.ts · quota.ts · rate-limit.ts · env.ts
│   ├── extract.ts (PDF/DOCX/PPTX/OCR) · chunk.ts · documents.ts · quiz.ts
│   ├── notify.ts (push + email) · api-keys.ts
│   └── payments/ index · stripe · mtn-momo · orange-money
├── middleware.ts                   Protection des pages privées (edge)
├── supabase/migrations/            ★ 0001 schéma+RLS · 0002 gamification · 0003 apprentissage · 0004 données · 0005 cron · 0006 classement + documents sans /api · 0007 durcissement · 0008 concours & annales
├── vercel.json · package.json · tsconfig.json · .env.example
```

---

## 3. Démarrage rapide (mode démo)

```bash
npm install
npx vercel dev          # ou : python -m http.server 3000 (pages seules, sans /api)
```

Ouvre `http://localhost:3000`. Sans configuration, tout s'affiche en mode démo.

---

## 4. Mise en production pas à pas

### 4.0 Lancer en local avec Gemini

1. Crée une clé sur <https://aistudio.google.com/apikey> et colle-la dans `.env.local`, ligne `GEMINI_API_KEY=`.
2. Double-clique sur `LANCER-RELBRAIN.bat` (ou `npm run dev`) : pages + `/api` sur `http://localhost:3005`, sans compte Vercel. Le serveur redémarre à chaque enregistrement de `.env.local`.
3. Administration : `relbrain-admin.html`. Pour nommer un administrateur, voir l'en-tête de `supabase/migrations/0009_admin.sql`.

### 4.1 Supabase

> **État actuel (20/10/2026)** — projet connecté : `tuyhhcfghvhqyoqebuds` (eu-central-1).
> Migrations 0001 → 0008 appliquées (0008 le 23/10/2026), clés publiques dans `relbrain-config.js`,
> clés serveur dans `.env.local` (jamais commité). Il reste à faire **dans le
> dashboard** les étapes 4 et 6 ci-dessous (URL de redirection + SMTP).

1. Crée un projet sur <https://supabase.com/dashboard> (région la plus proche de tes élèves, ex. Europe de l'Ouest).
2. **Extensions** (Database → Extensions) : active `vector` et `pg_cron`.
3. **Migrations** — au choix :
   - CLI : `npx supabase link --project-ref <ref>` puis `npm run db:push` ;
   - ou copie-colle dans l'éditeur SQL, **dans l'ordre**, `supabase/migrations/0001` → `0008`.
4. **Authentication → URL Configuration**
   - *Site URL* : `https://ton-domaine`
   - *Redirect URLs* : `https://ton-domaine/relbrain-validation-email.html`, `https://ton-domaine/relbrain-reset-password.html`, `https://ton-domaine/relbrain-accueil.html` (et les mêmes en `http://localhost:3000/…` pour le développement).
5. **Authentication → Providers → Google** (optionnel) : renseigne le Client ID/Secret Google ; le bouton Google des pages connexion/inscription l'utilise directement.
6. **Authentication → Emails → SMTP** : branche un SMTP (Resend, Brevo…) pour que les emails de confirmation arrivent bien (le SMTP par défaut de Supabase est très limité). Personnalise les modèles en français.
7. **Authentication → Rate Limits** : garde les limites par défaut (elles complètent la limitation faite dans `/api/auth/*`).
8. **Authentication → Multi-Factor** : active TOTP pour la double authentification (Paramètres → Sécurité).

### 4.2 Variables d'environnement

```bash
cp .env.example .env.local      # puis remplis chaque bloc 🔑
```

Recopie `SUPABASE_URL` et `SUPABASE_ANON_KEY` (publiques) dans **`relbrain-config.js`**.

### 4.3 Vercel

1. Importe le dépôt sur <https://vercel.com/new> (framework : *Other*).
2. Ajoute toutes les variables de `.env.example` dans *Settings → Environment Variables*.
3. Déploie, puis ouvre `https://ton-domaine/api/health` : chaque intégration doit être à `true`.
4. **Cron** : `vercel.json` lance `/api/cron/notifications` chaque jour à 17 h UTC (18 h au Cameroun) et `/api/cron/subscriptions` chaque matin, ce qu'autorise le plan gratuit. Avec un plan payant, tu peux passer les rappels en horaire (`0 * * * *`) et mettre `REMINDERS_HOURLY=true`.
5. Toutes les routes passent par `api/router.ts` (`maxDuration: 300`, le maximum du plan gratuit) : le plan gratuit limite un projet à 12 fonctions, RelBrain n'en utilise qu'une. Guide pas à pas : `GUIDE-LANCEMENT.md`.

### 4.4 Paiements

| Prestataire | À faire |
|---|---|
| **Stripe** | Clé secrète + webhook `https://ton-domaine/api/webhooks/stripe` (événements `checkout.session.*`). |
| **MTN MoMo** | Compte sur momodeveloper.mtn.com, produit *Collection*, API user/key. Sandbox d'abord (`MTN_MOMO_TARGET_ENV=sandbox`), puis `mtncameroon` après le contrat marchand. |
| **Orange Money** | Application sur developer.orange.com, API *OM Web Payment* Cameroun, clé marchand. ⚠️ Vérifie les URL exactes et la devise de test dans ton espace Orange. |

Modèle retenu : **achat de périodes** (1 mois, ou 12 mois au prix de 10), sans prélèvement automatique — adapté au Mobile Money. Rappel automatique 3 jours avant l'échéance.

### 4.5 Notifications push

```bash
npm run vapid       # génère VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
```

---

## 5. Où insérer les clés API

Chaque emplacement est signalé dans le code par un bloc `🔑 CLÉ API À INSÉRER ICI` qui explique où obtenir la clé, et par `⬅️ LA CLÉ EST ICI` sur la ligne exacte.

| Clé | Fichier qui la lit | Publique ? |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | `relbrain-config.js`, `lib/supabase.ts` | ✅ oui |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase.ts` | ❌ secrète |
| `SUPABASE_JWT_SECRET` (anciens projets) | `middleware.ts` | ❌ secrète |
| `OPENAI_API_KEY` | `lib/ai/openai.ts` | ❌ secrète |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `relbrain-config.js` / `lib/notify.ts` | ✅ / ❌ |
| `RESEND_API_KEY` | `lib/notify.ts` | ❌ secrète |
| `CRON_SECRET` | `server/cron/*.ts` | ❌ secrète |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `lib/payments/stripe.ts`, `server/webhooks/stripe.ts` | ❌ secrètes |
| `MTN_MOMO_*` | `lib/payments/mtn-momo.ts` | ❌ secrètes |
| `ORANGE_MONEY_*` | `lib/payments/orange-money.ts` | ❌ secrètes |

> Les liens des réseaux sociaux (Discord, WhatsApp, TikTok…) sont centralisés en haut de `relbrain-site.js` (`SOCIAL`) : remplace les URL d'exemple par les vraies.

---

## 6. Backend : ce qui est fait

**Authentification** — inscription email/mot de passe avec profil complet, validation d'email (+50 XP), connexion, déconnexion, mot de passe oublié/réinitialisation, Google OAuth, double authentification TOTP, déconnexion de tous les appareils. Limitation de débit sur `/api/auth/*` (par IP et par email, sans révéler si un compte existe). Session rafraîchie automatiquement ; pages privées protégées par `middleware.ts` (cookie `rb-at` vérifié en edge) et par un garde côté client.

**Documents** — dépôt direct du navigateur dans un bucket **privé** (`documents/{user_id}/…`, RLS Storage), validation du type par **signature binaire** et de la taille selon le forfait, extraction PDF (`pdf-parse`), DOCX (`mammoth`), PPTX (`jszip`), images (OCR par GPT-4o vision), découpage en chunks + embeddings (`pgvector`, index HNSW) pour le RAG, statut `pending → processing → ready/failed` diffusé en **temps réel**, suppression du fichier et des données liées.

**IA** — `POST /api/ai/analyze | quiz | flashcards | summary | chat`. Prompts centralisés dans `lib/ai/prompts.ts` (taxonomie de Bloom par difficulté, règles de Wozniak pour les flashcards, coach socratique, contexte Bac/GCE/concours). Sorties JSON validées par `zod` avec relance corrective, retry exponentiel, timeout, modèle de repli, suivi des tokens et du coût (`ai_usage`), quotas par plan et limite de rafale par minute. Chat en **streaming** (SSE) avec contexte RAG.

**Quiz notés côté serveur** — les bonnes réponses ne sont **pas lisibles** par le navigateur (privilèges de colonnes) : `check_answer()` corrige chaque réponse (QCM, vrai/faux, réponse courte tolérante aux accents, calcul avec tolérance, rédaction auto-évaluée), `finish_quiz_attempt()` calcule score, XP, bonus et points faibles.

**Progression** — `study_sessions`, `quiz_attempts`, `quiz_answers`, `flashcard_reviews` (SM-2 dans `review_flashcard()`), `user_progress` (maîtrise par matière), vue `v_concept_stats`, `get_weak_points()`, `get_recommendations()`, `get_activity()` (section Historique du tableau de bord `dashboard.html#historique` : filtres, graphiques, sessions, documents importés). Classement : `get_leaderboard(scope, period)` — ligue, semaine, général, pays, établissement, avec ta position même hors du top.

**Concours** — page `relbrain-concours.html` (menu, sous Classement) : catalogue des concours (IUT de Douala, ENSP Douala et Yaoundé en 1re et 3e année, ESSEC, JFN, Saint Jérôme, UCAC), puis pour chaque concours ses niveaux et ses épreuves par année, de la plus récente à la plus ancienne. Tables `concours` → `concours_levels` → `concours_annales`, lecture réservée aux élèves connectés, écriture réservée à l'équipe (`service_role`). Les PDF vont dans le bucket privé `annales` et s'ouvrent par lien temporaire de 10 min. « S'entraîner » copie le texte de l'épreuve (`content_text`) dans Mes documents, puis ouvre la création de quiz (cela compte dans le quota de documents). La marche à suivre pour ajouter une épreuve est en tête de `supabase/migrations/0008_concours.sql`.

**Notifications** — table `notifications` + préférences par catégorie, centre de notifications avec lu/non-lu et temps réel, Web Push (service worker), emails (Resend), **rappels intelligents** à l'heure d'étude habituelle apprise (`refresh_study_habits()`), heures calmes, messages du coach stockés par conversation.

**Gamification** — `add_xp()` (multiplicateurs de série, vitesse, perfection ; plafond ×3), niveaux à ×1,5, séries avec gel automatique, **45 badges** (dont 2 secrets) débloqués automatiquement, ligues Bronze → Maître par groupes de 30 avec clôture le dimanche (promotion top 7 / relégation 5 derniers), 3 défis quotidiens + 1 hebdomadaire, récompenses (thèmes, avatars, titres) par niveau ou badge.

**Abonnements** — `plans`, `subscriptions`, `payments`, quotas par plan, checkout Stripe / MTN MoMo / Orange Money, webhooks (signature Stripe vérifiée ; callback MTN re-vérifié auprès de l'API ; jeton Orange comparé), expiration automatique et rappel J-3.

**RGPD** — export JSON de toutes les données (`/api/account/export`), suppression définitive du compte et des fichiers (`/api/account/delete`).

**API publique** — clés `rb_live_…` hachées (SHA-256), scopes, 60 req/min, `GET/POST /api/v1/quizzes`.

**Contrôles effectués** : migrations SQL analysées par le parseur PostgreSQL (`pglast`, SQL + PL/pgSQL) ; `tsc --noEmit` sans erreur ; tests unitaires rapides du découpage, de la détection MIME et des schémas ; les 27 pages chargées dans un navigateur sans erreur console. **Non testé de bout en bout** : les appels réels à Supabase, OpenAI et aux opérateurs de paiement (aucune clé disponible ici) — à valider après configuration, en commençant par `/api/health`.

---

## 7. Design system « Cahier vivant »

Toute l'identité est dans **`relbrain-design-system.css`** (sommaire en tête de fichier) et démontrée sur **`relbrain-design-system.html`**.

- **Tokens** : couleurs (palette crème / violet / rose inchangée + rôles sémantiques), typographie (Fraunces + Plus Jakarta Sans), espacements, rayons (dont le rayon « feuille cornée »), ombres (dont l'ombre « papier posé »), durées et courbes d'animation, thème sombre « cahier à la lampe ».
- **Six animations signature**, chacune avec un rôle pédagogique : *surligneur* (repérer l'essentiel), *synapse* (l'IA connecte les idées — remplace tous les spinners), *éclat de savoir* (bonne réponse), *montée d'XP & niveau supérieur* (rendre l'effort visible), *courbe de l'oubli* (pourquoi réviser), *révélation à l'encre* (une idée après l'autre).
- **Micro-interactions** : lift + ombre colorée, onde au clic, check qui se dessine, tampon « Validé », shake doux, squelettes papier, retournement de carte.
- **Accessibilité** : `prefers-reduced-motion` respecté partout, focus visibles, régions `aria-live` pour les toasts et l'IA. Un audit de contraste (clair et sombre) reste à faire.

Les pages historiques chargent `relbrain-theme.css` (alias) : elles héritent automatiquement de la typographie, du fond « cahier », des micro-interactions et du mode sombre, sans modification de leur structure.

> Les personnages africains cartoon mentionnés dans le cahier des charges ne figuraient pas dans les fichiers reçus. La page d'accueil intègre une élève illustrée en SVG (style 2D) à l'emplacement prévu ; remplace-la par les illustrations officielles quand elles seront disponibles.

---

## 8. Ajouter un article de blog

Ajoute un objet en tête du tableau `posts` de `content/blog/posts.json` (`slug`, `title`, `excerpt`, `category`, `date`, `reading_minutes`, `cover`, `blocks`). Types de blocs : `p`, `h2`, `h3`, `ul`, `ol`, `quote`, `callout`, `tip`, `warn` ; mise en forme `**gras**`, `_italique_`, `[lien](url)`. L'article est servi sur `relbrain-article.html?slug=…`.

---

## 9. Limites connues et prochaines étapes

- **Textes juridiques** : modèles à compléter (champs surlignés) et à faire valider par un juriste.
- **Webhooks sortants, widgets embarquables, SDK** : documentés et architecturés, pas encore livrés (marqués « bientôt »).
- **Tableau de bord enseignant / groupes (Premium)** : annoncé sur la page Tarifs, non développé.
- **Gestion des clés API dans Paramètres** : la route `/api/keys` existe, l'interface reste à ajouter.
- **PayPal** : affiché comme « bientôt ».
- **SEO du blog** : rendu côté client depuis le JSON ; pour un meilleur référencement, pré-générer les pages articles au build.
- **Monitoring** : brancher Sentry (ou équivalent) sur les fonctions `/api`.
