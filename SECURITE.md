# Sécurité de RelBrain — comment tout gérer

> Ce fichier n'est pas visible sur le site (les fichiers `.md` sont bloqués).
> Dernier audit complet : 19 novembre 2026.

## 1. Ce qui protège déjà RelBrain (automatique)

| Couche | Protection | Où |
|---|---|---|
| **Base de données** | Chaque table est verrouillée (RLS) : un élève ne voit et ne modifie **que ses propres données**. | Supabase |
| | Un élève ne peut pas se donner les droits admin, de l'XP ou un forfait : seules les colonnes inoffensives (nom, école, thème…) sont modifiables. | Supabase |
| | Les fonctions d'administration vérifient que l'appelant est admin. | `assert_admin()` |
| | Les visiteurs non connectés n'ont **aucun** droit d'écriture. Personne ne peut vider une table. | migration `0014_securite.sql` |
| **Fichiers** | Chaque élève ne lit et ne supprime que ses documents. Formats et taille (20 Mo) contrôlés. | Supabase Storage |
| **Comptes** | Mots de passe jamais stockés en clair (Supabase les chiffre avec bcrypt). | Supabase Auth |
| | Connexion : 10 essais / 15 min par appareil **et** 5 essais / 15 min par compte. Message d'erreur neutre (on ne révèle pas si le compte existe). | `server/auth/login.ts` |
| | Inscription : 30 / heure par appareil, piège à robots (champ invisible + temps minimum). | `server/auth/signup.ts` |
| | Double authentification (code à 6 chiffres) disponible : Paramètres → Sécurité. | |
| **API (serveur)** | Toutes les routes sensibles ont une limite de débit. Requêtes de plus de 2 Mo refusées. Adresse IP lue depuis Vercel (impossible à falsifier). | `lib/http.ts` |
| | Seul ton site peut appeler l'API (CORS). Les erreurs internes ne sont jamais montrées aux visiteurs. | `lib/http.ts` |
| | Les clés secrètes (Supabase service_role, Gemini…) sont **uniquement** sur Vercel, jamais dans le code du site. | Vercel → Environment Variables |
| **Navigateur** | Politique de sécurité (CSP) : la page ne peut charger du code que depuis ton site et 2 CDN de confiance → bloque l'essentiel des injections de code (XSS). | `vercel.json` |
| | HTTPS obligatoire (HSTS), site non intégrable dans un autre site (anti-clickjacking), caméra/micro/position désactivés. | `vercel.json` |
| | Code source, migrations, guides internes : inaccessibles par URL (404). | `middleware.ts` |
| **Réseau** | Protection anti-DDoS automatique de Vercel. | Vercel |

## 2. À faire toi-même (10 minutes, une seule fois)

Ces réglages ne peuvent se faire que dans les tableaux de bord, avec ton compte.

1. **Double authentification sur TOUS tes comptes** (le plus important) : GitHub, Vercel, Supabase, Google (Gemini), et ton compte admin RelBrain (Paramètres → Sécurité). Si quelqu'un vole un de ces comptes, il contrôle tout RelBrain.
2. **Supabase → Authentication → Providers → Email** :
   - *Minimum password length* : **8** ;
   - *Password requirements* : **lettres et chiffres**.
3. **Supabase → Authentication → Sign In / Providers → « Allow new users to sign up » : OFF.**
   Les inscriptions passent par le serveur RelBrain (avec ses pièges à robots), qui continue de fonctionner. Ce réglage empêche seulement un robot de créer des comptes en appelant Supabase directement avec la clé publique.
   ⚠️ Le jour où tu mets `REQUIRE_EMAIL_CONFIRM=true`, remets ce réglage sur ON.
4. **Supabase → Authentication → Rate Limits** : laisse les valeurs par défaut (elles complètent celles de RelBrain).

## 3. Routine de surveillance

| Quand | Quoi | Comment |
|---|---|---|
| Chaque semaine | Lire les messages et avis | Salle des profs (page admin) |
| Chaque mois | Contrôle automatique de sécurité | Supabase → **Advisors → Security** : il ne doit rester que les avertissements listés en section 5 |
| Chaque mois | Failles dans les bibliothèques | `npm audit --omit=dev` (à lancer dans le dossier du projet) |
| Chaque mois | Sauvegarde de la base | Le plan gratuit de Supabase n'a **pas** de sauvegarde automatique : demande-moi un export, ou passe au plan Pro (sauvegardes quotidiennes) dès que RelBrain a beaucoup d'élèves |
| Si quelque chose semble anormal | Journaux | Supabase → Logs (Auth, API) · Vercel → Logs (1 heure d'historique sur le plan gratuit) |

## 4. En cas d'attaque ou de fuite

**Le site est inondé de requêtes (lenteurs, coupures)**
→ Vercel → ton projet → **Firewall → Attack Challenge Mode : ON**. Les robots sont bloqués, les vrais visiteurs passent après un court contrôle. Remets OFF quand c'est calme.

**Une clé secrète a fuité** (envoyée par erreur, capture d'écran…)
1. Génère une nouvelle clé là où elle a été créée :
   - Supabase `service_role` → Supabase → Settings → API → *Roll / regenerate* ;
   - Gemini → aistudio.google.com → API keys → supprimer puis recréer ;
   - Resend → resend.com → API Keys.
2. Mets la nouvelle valeur dans `.env.local` puis :
   ```bash
   npm run vercel:env
   npm run deploy
   ```

**Un compte élève est piraté**
→ Salle des profs → retrouve l'élève, ou Supabase → Authentication → Users → l'utilisateur → *Send password recovery* / *Delete user*.

**Le site doit être coupé en urgence**
→ Salle des profs → **Maintenance : ON**. Tout le monde voit la page de maintenance (sauf toi).

## 5. Avertissements connus (acceptés)

Supabase → Advisors en affiche encore quelques-uns, volontairement :
- *RLS enabled no policy* sur `league_groups`, `league_weeks`, `rate_limits` : tables internes, personne n'y accède depuis le navigateur (c'est voulu).
- *Security definer function executable* : ce sont les fonctions de l'appli (quiz, flashcards, classement…), chacune vérifie l'identité de l'élève ; celles de la salle des profs vérifient en plus qu'il est admin.
- *Extension in public* (`vector`) : sans risque pour RelBrain.
- *Leaked password protection* : vérification des mots de passe déjà piratés, réservée aux forfaits Supabase payants.

## 6. Reste à faire plus tard

- Mettre à jour `zod` (v3 → v4) et `openai` (v4 → v7) : failles « élevées » signalées par `npm audit`. Le risque est faible (requêtes géantes, déjà limitées à 2 Mo), mais ce sont des changements de version majeure à tester avant de publier.
- Au lancement payant : nom de domaine + service d'emails (Resend) branché dans Supabase → puis `REQUIRE_EMAIL_CONFIRM=true` pour revalider les adresses email.
