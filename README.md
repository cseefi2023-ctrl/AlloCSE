# AlloCSE

Application de suivi des demandes des salariés vers le CSE, à la manière d'un ServiceNow.
Elle est hébergée gratuitement, sans serveur à soi :

- **l'interface** est publiée sur **GitHub Pages**, à l'adresse `https://<compte>.github.io/<dépôt>/`, et s'ouvre depuis un PC ou un téléphone ;
- **les données** sont dans **Supabase** (base PostgreSQL, comptes des élus, modèles Word privés).

## Ce que fait l'application

**Côté salarié, sans compte**
- Faire une **demande** ou un **signalement**. Un signalement porte sur une situation actuelle ou à venir, avec sa date de début et de fin si elles sont connues. La demande peut être anonyme ou non.
- **Choisir qui peut lire** : tous les élus, ou seulement ceux qu'il coche. Ce choix s'impose à tout le monde, administrateurs compris. Un élu exclu ne voit ni le contenu de la demande ni même son existence.
- Cocher **« Recevoir un e-mail quand ma demande avance »** : un e-mail part à chaque réponse ou message du CSE et à la clôture. L'e-mail ne contient pas la réponse, il invite à la lire dans l'appli. Pour une demande anonyme, l'adresse n'est jamais montrée aux élus et elle est effacée à la clôture.
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
- **Données de l'espace** (administrateurs) : exporter toutes les données dans un fichier, **repartir de zéro**, recharger un fichier d'un clic, ou charger l'exemple fictif fourni (voir « Préparer une présentation »).

## Plusieurs espaces : EFI, démonstration, autres entreprises

Un même site sert plusieurs CSE. **Chaque entreprise a sa propre base Supabase**, totalement séparée des autres, et son propre lien :

| Lien | Espace |
|---|---|
| `https://cseefi2023-ctrl.github.io/AlloCSE/?cse=efi` | CSE EFI Automotive |
| `https://cseefi2023-ctrl.github.io/AlloCSE/?cse=demo` | démonstration (données fictives, remises à zéro chaque nuit) |
| `https://cseefi2023-ctrl.github.io/AlloCSE/?cse=<client>` | un autre CSE client |

- Sans `?cse=`, le site ouvre le dernier espace utilisé sur l'appareil, sinon l'espace `default` de `public/config.js`.
- Un lien inconnu affiche « Espace introuvable », sans jamais lister les autres clients.
- Connexions et numéros de suivi sont mémorisés séparément pour chaque espace.
- Les espaces sont déclarés dans [`public/config.js`](public/config.js) : pour chacun, l'URL du projet Supabase et sa clé publique.

**Limite de l'offre gratuite** : Supabase autorise **2 projets gratuits par compte** (ici EFI + démonstration). Pour un client de plus : soit le client crée son propre compte Supabase gratuit et vous donne l'URL et la clé publique de son projet (c'est aussi le plus propre pour ses données), soit vous passez à l'offre payante de Supabase.

### Ajouter une entreprise

1. Créer son projet Supabase et y exécuter `supabase/schema.sql` (étapes 1.1 à 1.4 ci-dessous).
2. Ajouter dans `public/config.js` :
   ```js
   acme: { name: 'CSE Acme', supabaseUrl: 'https://….supabase.co', supabaseAnonKey: 'sb_publishable_…' },
   ```
3. Dans ce projet Supabase, **Authentication > URL Configuration** : *Site URL* `https://cseefi2023-ctrl.github.io/AlloCSE/?cse=acme` et *Redirect URLs* `https://cseefi2023-ctrl.github.io/AlloCSE/**`.
4. Le premier compte créé avec le lien `?cse=acme` devient l'administrateur de cet espace.

### Créer l'espace de démonstration

1. Créer un second projet Supabase (par exemple `allocse-demo`), y exécuter `supabase/schema.sql`, désactiver « Confirm email ».
2. Renseigner l'espace `demo` dans `public/config.js` (URL et clé publique de ce projet).
3. Ouvrir `…/AlloCSE/?cse=demo#/elus/connexion` et créer **deux comptes** avec « Je suis un nouvel élu » :
   `demo-admin@allocse.app` puis `demo-elu@allocse.app` (n'importe quel mot de passe : il sera remplacé).
4. Exécuter `supabase/demo.sql` dans le SQL Editor de ce projet **uniquement**. Il marque la base comme démonstration, remplit l'exemple et fixe le mot de passe `demo-allocse` des deux comptes.
5. C'est prêt : la page de connexion propose « Entrer comme administrateur » ou « comme élu » en un clic, un bandeau signale les données fictives, et le workflow `demo-reset.yml` remet tout à zéro chaque nuit (comptes, réglages, exemple). L'envoi de modèles Word y est désactivé.
6. Pour en faire la page d'accueil des prospects, mettre `default: 'demo'` dans `public/config.js` et donner aux salariés EFI le lien `?cse=efi`.

## Préparer une présentation (repartir de zéro, puis tout remplir d'un clic)

Dans **Élus > Données de l'espace** (administrateurs) :

1. Préparez vos demandes, réunions et engagements dans l'espace, puis cliquez sur **Exporter** : vous obtenez un fichier `allocse-efi-AAAA-MM-JJ.json`. Gardez-le en lieu sûr (il contient les demandes, les noms des demandeurs non anonymes, etc.).
2. Avant la présentation, **Vider l'espace** (taper `EFFACER`) : l'appli est comme neuve. Les comptes des élus, les réglages et les modèles Word restent en place.
3. Pendant la présentation, **Charger un fichier** et choisir l'export : tout réapparaît d'un coup.
   Avec l'option **« Décaler les dates à aujourd'hui »**, toutes les dates avancent du temps écoulé depuis l'export : une demande déposée « il y a 3 jours » le reste, les réunions à venir restent à venir.
4. Sans fichier préparé, **Charger l'exemple** remplit l'espace avec un CSE fictif : signalements (fontaine balisée, travail le samedi…), demandes (chèques cadeaux…), deux réunions et des engagements de la direction, dont un en retard.

Le chargement n'est possible que dans un espace vide. Les élus sont reconnus par leur adresse e-mail : un élu absent de l'espace est simplement laissé vide, et une demande réservée à des élus absents est confiée à l'administrateur qui charge le fichier.

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
2. Éditer **`public/config.js`** directement sur GitHub et y coller l'URL et la clé publique de l'espace :
   ```js
   window.ALLOCSE_CONFIG = {
     default: 'efi',
     tenants: {
       efi: { name: 'CSE EFI Automotive', supabaseUrl: 'https://abcdefgh.supabase.co', supabaseAnonKey: 'sb_publishable_...' },
     },
   }
   ```
3. Ouvrir **Settings > Pages**. Dans **Build and deployment > Source**, choisir **GitHub Actions**.
4. L'onglet **Actions** montre la publication en cours (environ 1 minute). L'adresse du site s'affiche ensuite dans Settings > Pages.

### 3. Relier les deux

Dans Supabase, ouvrir **Authentication > URL Configuration** :
- **Site URL** : `https://<compte>.github.io/AlloCSE/?cse=efi`
- **Redirect URLs** : ajouter `https://<compte>.github.io/AlloCSE/**`.

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
- **E-mails aux salariés** (Brevo, gratuit jusqu'à 300 e-mails par jour) :
  1. Brevo : valider un expéditeur, puis créer une **clé API** (*SMTP et API > Clés API*). Si Brevo bloque les adresses IP inconnues (*Sécurité > IP autorisées*), désactiver ce blocage : les envois partent des serveurs de Supabase.
  2. Supabase : **Integrations > Vault > Add new secret**, nom `brevo_api_key`, valeur : la clé API. Elle reste chiffrée dans la base et n'apparaît jamais dans le code.
  3. Appli, **Élus > E-mails aux salariés** : adresse d'expédition, puis « M'envoyer un e-mail de test ».

  Les envois partent chaque minute depuis la base (extensions `pg_cron` et `pg_net`, activées par le script). Pour une base déjà installée : exécuter `supabase/migration_notifications.sql`.
- **Mot de passe oublié** : le lien part par e-mail. Il faut donc un service d'envoi dans Supabase, dans **Authentication > Emails > SMTP Settings** (le SMTP de l'entreprise, ou un service gratuit comme Brevo). Sans service d'envoi : supprimer le compte dans **Authentication > Users**, l'élu se réinscrit et vous le revalidez.
- **Mise en veille** : les projets Supabase gratuits se mettent en pause après 7 jours sans activité. Le workflow `keepalive.yml` appelle chaque espace tous les 3 jours pour l'éviter.

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
│   ├── migration_espaces.sql   mise à jour d'une base déjà installée (conserve les données)
│   ├── migration_notifications.sql  mise à jour : e-mails aux salariés
│   ├── demo.sql                transforme une base en démonstration (projet démo uniquement)
│   └── reset.sql               remise à zéro avant réinstallation
├── public/
│   ├── config.js               espaces : une base Supabase par entreprise (URL + clé publique)
│   └── modeles/                modèles Word neutres (par défaut)
├── src/
│   ├── tenant.js               choix de l'espace d'après le lien (?cse=…)
│   ├── api.js                  appels à Supabase (mêmes routes que la version serveur)
│   ├── word.js                 fabrication des documents Word dans le navigateur
│   └── pages/                  Accueil, Déposer, Suivi, elus/*
├── .github/workflows/
│   ├── deploy.yml              publication automatique sur GitHub Pages
│   ├── keepalive.yml           évite la mise en veille de chaque espace
│   └── demo-reset.yml          remet la démonstration à zéro chaque nuit
├── scripts/espaces.mjs         liste les espaces de config.js (pour les workflows)
└── index.html, vite.config.js
```

**Développer en local** : `npm install` puis `npm run dev`, et ouvrir `http://localhost:5173`.

**Faire évoluer la base** : écrire les modifications en SQL et les exécuter dans le SQL Editor.
Ne pas relancer `schema.sql` sur une base existante : il recrée les tables. Pour une base installée avant les espaces, exécuter une fois `supabase/migration_espaces.sql`.
