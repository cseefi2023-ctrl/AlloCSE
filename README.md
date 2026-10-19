# AlloCSE

Application de suivi des demandes des salariés vers le CSE, à la manière d'un ServiceNow.
Elle est hébergée gratuitement, sans serveur à soi :

- **l'interface** est publiée sur **GitHub Pages**, à l'adresse `https://<compte>.github.io/<dépôt>/`, et s'ouvre depuis un PC ou un téléphone ;
- **les données** sont dans **Supabase** (base PostgreSQL, comptes des élus, modèles Word privés).

## Ce que fait l'application

**Côté salarié, sans compte**
- Faire une **demande** ou un **signalement**. Un signalement porte sur une situation actuelle ou à venir, avec sa date de début et de fin si elles sont connues. La demande peut être anonyme ou non.
- **Choisir qui peut lire** : tous les élus, ou seulement ceux qu'il coche. Ce choix s'impose à tout le monde, administrateurs compris. Un élu exclu ne voit ni le contenu de la demande ni même son existence.
- Recevoir un **numéro de suivi** (`AC-2026-7KQ4-X9M2`, impossible à deviner). Avec ce numéro, il suit l'avancement, lit la réponse du CSE et peut ajouter des précisions.

**Côté élus, avec un compte validé**
- Tableau de bord, liste filtrable, prise en charge, priorité, échéance, notes internes.
- **Tri en sujets** (`S-2026-001`). Une demande devient un *nouveau sujet*, ou est *associée* à un sujet existant quand plusieurs salariés soulèvent le même problème. Un sujet n'occupe qu'un point à l'ordre du jour, sa réponse parvient à tous les demandeurs, et toutes ses demandes partagent le même statut.
- **Réponse directe** au salarié à tout moment, sans attendre la réunion.
- **Préparation des réunions** : la prochaine plénière, la prochaine extraordinaire et les autres réunions planifiées, avec une date proposée.
- **« Générer l'ordre du jour »** ajoute en un clic :
  - les points fixes (approbation du PV, organisation…) ;
  - les sujets à traiter, chacun avec sa **phrase type**.

  Ces phrases sont des modèles réglables, **sans IA**, et ne mentionnent jamais l'identité du demandeur.
- **Points récurrents** : un point peut revenir à chaque réunion, une réunion sur N, ou seulement certains mois (par exemple tous les trimestres), avec une date de fin.
- **Documents Word** : la convocation avec l'ordre du jour, et la trame du PV avec les relevés de décision. Les deux sont produits dans la mise en page du CSE.
- **Suivi des sujets** sous forme de diagramme de Gantt : du dépôt à l'échéance, avec les retards et les passages en réunion.
- Un point de l'ordre du jour qu'un élu n'a pas le droit de voir apparaît chez lui comme « point à accès restreint », y compris dans les documents Word.
- Administration : validation des comptes, rôles, thèmes, phrases types, points fixes, modèles Word.

## Mise en route (environ 15 minutes, une seule fois)

### 1. Supabase : la base de données

1. Créer un compte sur [supabase.com](https://supabase.com), puis un **New project**. Choisir une région en Europe (Paris ou Frankfurt).
2. Ouvrir **SQL Editor**, puis **New query**. Coller tout le contenu de [`supabase/schema.sql`](supabase/schema.sql) et cliquer sur **Run**. Le message attendu est « Success. No rows returned ».
   - *Si une version précédente d'AlloCSE est déjà installée* : exécuter d'abord [`supabase/reset.sql`](supabase/reset.sql). Il **efface toutes les données**. Supprimer aussi les comptes dans **Authentication > Users**.
3. Ouvrir **Authentication > Sign In / Providers > Email** et **désactiver « Confirm email »**.
   - Le service d'e-mail gratuit de Supabase n'envoie qu'aux membres de votre équipe Supabase, et seulement 2 messages par heure. Sans cette désactivation, les élus ne pourraient pas confirmer leur compte.
   - L'accès reste protégé : chaque nouveau compte doit être **validé par un administrateur** dans l'appli.
4. Ouvrir **Project Settings > API Keys** et copier :
   - la **Project URL**, visible aussi dans **Project Settings > Data API** ;
   - la **clé publique** : la *publishable key* (`sb_publishable_…`), ou la clé **anon** de l'onglet *Legacy API keys*. Les deux conviennent.
   - Ne jamais copier la clé *secret* ni la clé `service_role`.

### 2. GitHub : l'interface

1. Créer un dépôt (par exemple `allocse`) et y déposer tous les fichiers de ce dossier.
   Pour GitHub Pages gratuit, le dépôt doit être **public**. Il ne contient aucun secret ni aucune donnée : les modèles Word du CSE ne doivent **pas** y être déposés (voir plus bas).
2. Éditer **`public/config.js`** directement sur GitHub et y coller l'URL et la clé publique :
   ```js
   window.ALLOCSE_CONFIG = {
     supabaseUrl: 'https://abcdefgh.supabase.co',
     supabaseAnonKey: 'sb_publishable_...',
   }
   ```
3. Ouvrir **Settings > Pages**. Dans **Build and deployment > Source**, choisir **GitHub Actions**.
4. L'onglet **Actions** montre la publication en cours (environ 1 minute). L'adresse du site s'affiche ensuite dans Settings > Pages.

### 3. Relier les deux

Dans Supabase, ouvrir **Authentication > URL Configuration** :
- **Site URL** : `https://<compte>.github.io/allocse/`
- **Redirect URLs** : ajouter la même adresse.

### 4. Premier lancement

1. Ouvrir le site, cliquer sur **Espace élus > Je suis un nouvel élu** et créer **votre** compte en premier.
   **Le tout premier compte créé devient automatiquement administrateur.** Faites-le dès que le schéma est installé.
2. Dans **Élus**, copier le lien d'inscription et l'envoyer aux autres élus. Chacun crée son compte, puis vous le **validez**.
3. Dans **Élus > Modèles Word du CSE**, envoyer les modèles Word du CSE : `modele_odj.docx` et `modele_pv.docx`.
4. Partager l'adresse du site aux salariés (affichage, intranet, QR code…).

## Modèles Word

Un modèle est un document Word ordinaire (logo, destinataires, signatures) qui contient des **repères** :

| Repère | Rôle |
|---|---|
| `{{MOIS}}`, `{{DATE}}`, `{{DATE_COURTE}}`, `{{DATE_REUNION}}`, `{{DATE_DOC}}`, `{{TYPE}}` | remplacés dans le texte |
| `{{SECTION}}`, `{{TEXTE}}`, `{{POINT}}`, `{{SOUS_TITRE}}` (ODJ), `{{GROUPE}}` (PV) | paragraphes modèles, recopiés avec leur style |

- Les modèles du CSE sont **stockés dans l'espace privé de Supabase**. Seuls les élus validés peuvent les lire, et seuls les administrateurs peuvent les changer.
- Ils contiennent des noms et des appartenances syndicales : **ne les publiez jamais sur GitHub**.
- Sans modèle envoyé, AlloCSE utilise les modèles neutres de `public/modeles/`, qui ne contiennent ni nom ni logo.
- Le document est fabriqué dans le navigateur de l'élu : rien ne transite par un serveur tiers.

## Utilisation au quotidien

- **Réglages** (administrateurs, menu **Élus**) : entreprise, contact, thèmes, phrases types de l'ordre du jour, points fixes, heure et lieu des réunions, titres des documents Word.
- **Installer sur un téléphone** : ouvrir le site, puis menu du navigateur > « Ajouter à l'écran d'accueil ».
- **Mot de passe oublié** : le lien part par e-mail. Il faut donc un service d'envoi dans Supabase, dans **Authentication > Emails > SMTP Settings** (le SMTP de l'entreprise, ou un service gratuit comme Brevo). Sans service d'envoi : supprimer le compte dans **Authentication > Users**, l'élu se réinscrit et vous le revalidez.
- **Mise en veille** : les projets Supabase gratuits se mettent en pause après 7 jours sans activité. Le workflow `keepalive.yml` appelle la base tous les 3 jours pour l'éviter.

## Sécurité : comment c'est protégé

La clé publique est visible dans la page : c'est normal, elle est faite pour ça.
**Toutes les règles sont appliquées par la base elle-même** (Row Level Security et fonctions, dans `supabase/schema.sql`).

- **Sans compte**, on peut seulement :
  - lire la configuration ;
  - déposer une demande ;
  - consulter ou compléter **une** demande dont on connaît le numéro de suivi.

  Aucune table n'est lisible directement.
- **Un élu en attente de validation** ne voit rien.
- **Un élu validé** ne voit que :
  - les demandes ouvertes à tous ;
  - celles où le demandeur l'a coché, y compris dans les sujets associés, l'ordre du jour et les documents Word.

  Les notes internes ne sont jamais renvoyées côté salarié.
- **Demande anonyme** : ni nom, ni service, ni e-mail ne sont enregistrés.
- Toutes les écritures passent par des fonctions qui vérifient les droits. Seuls les **administrateurs** valident les comptes et modifient les réglages et les modèles.

## Structure

```
├── supabase/
│   ├── schema.sql              tables, règles d'accès, fonctions (à exécuter une fois)
│   └── reset.sql               remise à zéro avant réinstallation
├── public/
│   ├── config.js               connexion Supabase (URL + clé publique)
│   └── modeles/                modèles Word neutres (par défaut)
├── src/
│   ├── api.js                  appels à Supabase (mêmes routes que la version serveur)
│   ├── word.js                 fabrication des documents Word dans le navigateur
│   └── pages/                  Accueil, Déposer, Suivi, elus/*
├── .github/workflows/
│   ├── deploy.yml              publication automatique sur GitHub Pages
│   └── keepalive.yml           évite la mise en veille de Supabase
└── index.html, vite.config.js
```

**Développer en local** : `npm install` puis `npm run dev`, et ouvrir `http://localhost:5173`.

**Faire évoluer la base** : écrire les modifications en SQL et les exécuter dans le SQL Editor.
Ne pas relancer `schema.sql` sur une base existante : il recrée les tables.
