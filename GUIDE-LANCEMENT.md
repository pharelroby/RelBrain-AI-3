# 🚀 Guide de lancement de RelBrain (sans rien payer)

Ce guide t'emmène de ton ordinateur à un site en ligne que tu peux montrer
à ton université, avec les offres gratuites de Vercel, Supabase et Gemini.
Suis les étapes dans l'ordre. Compte environ une heure la première fois.

---

## 1. Les réglages faciles

Tu peux changer ces réglages sans risque, sans rien connaître au code.

### Dans `relbrain-config.js` (tout en haut du fichier)

| Réglage | Ce qu'il fait | Valeur conseillée pour le lancement |
|---|---|---|
| `PAIEMENTS_ACTIFS` | `false` : les offres Pro et Premium affichent « Bientôt disponible » et rien n'est encaissé | `false` |
| `BADGE_TEST` | Petit badge en bas à gauche de chaque page. `''` pour le cacher | `'Version de test · gratuit pendant le lancement'` |
| `LIEN_AVIS` | Page ouverte par « Donner mon avis » | `'relbrain-contact.html'` |

Modifie la valeur, enregistre, puis recharge la page.

### Dans `.env.local` (tout en bas du fichier)

| Variable | Rôle |
|---|---|
| `DEMO_EMAIL` | Adresse du compte de démonstration (voir étape 4) |
| `DEMO_PASSWORD` | Son mot de passe, **choisi par toi** (8 caractères minimum) |
| `PAYMENTS_ENABLED` | `false` tant que les paiements ne sont pas prêts |
| `REMINDERS_HOURLY` | `false` : un rappel de révision par jour, à 18 h (heure du Cameroun) |

> ⚠️ `.env.local` contient tes clés secrètes. Ne l'envoie jamais à personne
> et ne le publie nulle part. Il n'est pas envoyé à Vercel (fichier `.vercelignore`).

---

## 2. Régler Supabase pour la phase de test

Va sur <https://supabase.com/dashboard>, puis ouvre ton projet.

1. **Inscriptions sans email de confirmation (conseillé pendant le test).**
   L'envoi d'emails gratuit de Supabase est très limité : si 30 personnes
   s'inscrivent pendant ta présentation, la plupart ne recevront pas leur
   email. Désactive donc la confirmation :
   *Authentication → Sign In / Providers → Email → décoche « Confirm email » → Save.*
   Les nouveaux inscrits entrent alors directement dans l'application.
2. L'adresse de ton site viendra **après** l'étape 3. Tu reviendras ici pour la renseigner.

---

## 3. Mettre le site en ligne sur Vercel

### 3.1 Créer ton compte

Va sur <https://vercel.com/signup> et choisis le plan **Hobby** (gratuit).

### 3.2 Envoyer le site

1. Ouvre un terminal dans le dossier `RelBrainAI` (clic droit dans le dossier → « Ouvrir dans le terminal »).
2. Tape :

   ```bash
   npx vercel
   ```

3. La première fois, il te demande de te connecter : suis le lien.
4. Réponds aux questions :
   - *Set up and deploy?* → `Y`
   - *Link to existing project?* → `N`
   - *Project name* → `relbrain` (ou un autre nom si celui-ci est pris)
   - *In which directory is your code located?* → `./` (laisse tel quel)
   - *Want to modify these settings?* → `N`
5. À la fin, Vercel affiche une adresse du type `https://relbrain-xxxx.vercel.app`.
   Ton adresse définitive sera `https://relbrain.vercel.app` (ou le nom que tu as choisi).

### 3.3 Donner les clés à Vercel

Sur <https://vercel.com>, ouvre ton projet, puis *Settings → Environment Variables*.
Ajoute ces variables. Les valeurs sont dans ton `.env.local`, sauf mention contraire.

| Variable | Valeur |
|---|---|
| `SUPABASE_URL` | comme dans `.env.local` |
| `SUPABASE_ANON_KEY` | comme dans `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | comme dans `.env.local` |
| `GEMINI_API_KEY` | comme dans `.env.local` |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GEMINI_EMBEDDING_MODEL` | comme dans `.env.local` |
| `APP_URL` | l'adresse de ton site, par exemple `https://relbrain.vercel.app` (sans `/` à la fin) |
| `CRON_SECRET` | une longue suite au hasard (voir ci-dessous) |
| `PAYMENTS_ENABLED` | `false` |

Pour fabriquer le `CRON_SECRET`, tape dans le terminal :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copie le résultat, colle-le dans Vercel et ajoute la même ligne dans ton `.env.local`.

> Inutile d'ajouter les clés Stripe, Orange Money ou MTN MoMo pour l'instant.

### 3.4 Publier pour de bon

```bash
npx vercel --prod
```

Puis ouvre `https://ton-adresse.vercel.app/api/health`. Tu dois lire
`"supabase":true` et `"ai":"gemini"`. Si c'est le cas, tout est branché.

### 3.5 Dire à Supabase où vit ton site

Retourne dans Supabase : *Authentication → URL Configuration*.

- **Site URL** : `https://ton-adresse.vercel.app`
- **Redirect URLs** : ajoute `https://ton-adresse.vercel.app/**`

Sans ce réglage, la connexion Google et les emails de mot de passe oublié
ramèneraient vers ton ordinateur au lieu du site.

### 3.6 Publier une nouvelle version plus tard

Après chaque modification, retape simplement :

```bash
npx vercel --prod
```

---

## 4. Le compte de démonstration

Il sert à montrer RelBrain déjà rempli, sans attendre l'IA : documents,
flashcards, quiz déjà joué, XP et série de jours.

1. Dans `.env.local`, remplis par exemple :
   ```
   DEMO_EMAIL=ton.adresse+demo@gmail.com
   DEMO_PASSWORD=un-mot-de-passe-a-toi
   ```
   Astuce Gmail : `+demo` crée une deuxième adresse qui arrive dans ta boîte habituelle.
2. Lance :
   ```bash
   npm run demo
   ```
3. Connecte-toi sur le site avec cette adresse et ce mot de passe.

**Changer le contenu :** ouvre `content/demo/compte-demo.json`. C'est du texte
en français : titres, résumés, cartes, questions. Garde bien les guillemets `"`
et les virgules, puis relance `npm run demo`. Le compte repart propre à chaque fois.

---

## 4 bis. Les avis des élèves (uniquement des vrais)

Le site n'affiche ni faux témoignages, ni faux chiffres, ni noms d'écoles.
Les avis arrivent ainsi :

1. Après une vraie utilisation (2 quiz terminés, ou 15 cartes révisées, ou un
   document et un quiz, sur un compte d'au moins 2 jours), RelBrain propose à
   l'élève de donner une note et un commentaire. Il peut aussi cliquer sur
   « Donner mon avis » dans le badge en bas à gauche.
2. L'avis arrive dans la salle des profs : *Administration → Avis*.
3. Tu cliques sur **Valider** ou **Refuser**. Seuls les avis validés, dont l'auteur
   a accepté la publication, apparaissent sur la page d'accueil, avec la note moyenne.

Tant qu'aucun avis n'est validé, la page d'accueil explique honnêtement que
RelBrain vient d'ouvrir et que les premiers avis arrivent.

Pour régler quand la fenêtre d'avis s'ouvre, regarde en haut de la partie
« Avis des élèves » de `relbrain-app.js` : `REVIEW_SNOOZE_DAYS` (délai après
« Plus tard ») et `REVIEW_DELAY_MS` (attente avant l'ouverture).

---

## 5. Avant de présenter

- [ ] **Publier quelques vraies annales** depuis la salle des profs (*Administration → Annales*).
      La bibliothèque est vide tant que tu n'en as pas ajouté.
- [ ] **La veille :** ouvrir le site et te connecter. Supabase met en pause un
      projet gratuit après 7 jours sans activité. Le rappel quotidien de 18 h
      l'évite normalement, mais vérifie quand même.
- [ ] **Juste avant :** *Administration → IA → Tester l'IA*. Le quota gratuit de Gemini est
      petit et change souvent : ne fais qu'une ou deux démonstrations d'IA en direct.
- [ ] **Plan B sans Internet :** une courte vidéo de l'application, enregistrée à l'avance.
- [ ] **Un QR code** vers ton adresse sur ta dernière diapositive, pour que la salle s'inscrive.
- [ ] Le **compte de démonstration** est prêt (`npm run demo`).

---

## 6. Ce que permettent les offres gratuites

| Service | Gratuit jusqu'à | À surveiller |
|---|---|---|
| Vercel Hobby | Usage **non commercial** ; tâches planifiées une fois par jour | Pas d'encaissement d'argent sur ce plan |
| Supabase Free | 500 Mo de base, 1 Go de fichiers, 50 000 utilisateurs par mois | Pause après 7 jours sans activité ; pas de sauvegarde automatique |
| Gemini (clé gratuite) | Quelques dizaines de demandes par jour sur certains modèles (chiffres variables) | Message « quota atteint » : attendre le lendemain ou changer `GEMINI_MODEL` |

> Les données envoyées à l'offre gratuite de Gemini peuvent servir à Google
> pour améliorer ses produits : vérifie-le dans les conditions de Gemini. Si c'est
> le cas, conseille aux élèves de ne pas importer de documents personnels pendant le test.

---

## 7. Plus tard

- **Nom de domaine :** le GitHub Student Developer Pack offre un `.me` ou un `.tech`
  gratuit **la première année** (renouvellement payant). Prends-le quand le nom est
  définitif, puis ajoute-le dans Vercel : *Settings → Domains*.
- **Paiements :** quand Mobile Money ou la carte seront prêts, il faudra un plan Vercel
  payant (usage commercial). Mets alors `PAIEMENTS_ACTIFS: true` dans `relbrain-config.js`
  et `PAYMENTS_ENABLED=true` dans Vercel.
- **Rappels à l'heure de chaque élève :** avec un plan Vercel payant, passe le rappel
  en `0 * * * *` dans `vercel.json` et mets `REMINDERS_HOURLY=true`.

---

## 8. En cas de souci

| Ce que tu vois | Ce qu'il faut faire |
|---|---|
| `/api/health` affiche `"supabase":false` | Une variable Supabase manque dans Vercel : ajoute-la, puis `npx vercel --prod` |
| `"ai":false` | `GEMINI_API_KEY` manque dans Vercel |
| « Quota atteint » sur l'IA | Attends le lendemain, ou mets `gemini-3.5-flash-lite` dans `GEMINI_MODEL` |
| Après la connexion Google, retour sur `localhost` | Refais l'étape 3.5 |
| Le site affiche « Site en maintenance » | *Administration → Maintenance* : décoche, puis enregistre |
| `npm run demo` affiche une erreur sur le fichier JSON | Une virgule ou un guillemet manque dans `content/demo/compte-demo.json` |
| Sur ton ordinateur, l'IA ou les pages `/api` ne répondent plus | Ferme la fenêtre noire de `LANCER-RELBRAIN.bat` et relance-le |
