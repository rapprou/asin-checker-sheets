# ASIN Checker (Google Sheets)

Module Google Sheets qui indique, pour une liste d'ASINs, s'ils sont **vendables** sur Amazon :
pour chaque ligne, il interroge l'API Amazon Selling Partner
(`GET /listings/2021-08-01/restrictions`) et écrit le statut dans la feuille — vendable, soumis à
approbation, interdit, introuvable. La marketplace est à choisir dans l'onglet « Paramètres »
parmi FR, DE, ES, IT, UK et NL — aucune n'est présélectionnée.

Chaque utilisateur travaille dans **sa** copie du classeur, avec **ses propres clés SP-API** :
rien n'est mutualisé, et aucune clé n'est stockée dans ce dépôt.

## Captures

À ajouter dans `docs/img/` (fichiers non encore présents dans le dépôt) :

| Fichier attendu | Contenu |
|---|---|
| `docs/img/parametres.png` | Onglet « Paramètres » : état des clés, Seller ID, marketplace, test de connexion |
| `docs/img/asins.png` | Onglet « ASINs » avec les statuts en couleur |
| `docs/img/panneau.png` | Panneau de pilotage pendant une vérification |
| `docs/img/recap.png` | Onglet « Récap » |

---

# Pour un utilisateur du classeur

## Prérequis

- Un **compte vendeur Amazon professionnel**.
- Une **application SP-API auto-autorisée** (« self-authorized ») créée depuis Seller Central :
  c'est elle qui fournit les trois valeurs à saisir dans le classeur — `client_id`,
  `client_secret` et `refresh_token`.
- Le **Seller ID** (identifiant de marchand) du compte.

L'API Listings Restrictions n'est accessible qu'aux applications disposant des rôles adéquats.
Ces rôles et les quotas associés évoluent : référez-vous à la
[documentation Selling Partner API](https://developer-docs.amazon.com/sp-api/) d'Amazon plutôt
qu'à ce fichier. Si l'application n'a pas les droits requis, la vérification s'arrête sur une
erreur `HTTP 403` et le message vous renvoie vers les rôles de votre application.

## Installation

1. **Copiez le classeur modèle** qui vous a été partagé : *Fichier → Créer une copie*. Travaillez
   toujours dans votre copie.
2. Rechargez la copie. Un menu **« ASIN Checker »** apparaît dans la barre de menus, à droite
   d'« Extensions ». Il contient huit entrées en trois groupes (clés, vérification, affichage).
3. Cliquez sur n'importe quelle entrée du menu : Google demande votre autorisation. C'est normal,
   un script ne peut rien faire avant.

<!-- capture à ajouter : docs/img/parametres.png -->

### L'avertissement « Google n'a pas validé cette application »

À la première autorisation, Google affiche un écran rouge. Pour continuer :

> **Paramètres avancés** (en bas à gauche) → **Accéder à ASIN Checker (non sécurisé)** → **Autoriser**

Cet écran apparaît parce que le script n'a **pas été soumis à la procédure de validation de
Google**, qui ne concerne que les applications publiques. Ici, le script est livré classeur par
classeur : il ne s'exécute que dans votre copie, sous votre compte.

Les autorisations demandées sont volontairement minimales — vous pouvez les vérifier sur l'écran
de consentement :

| Autorisation | Ce qu'elle permet |
|---|---|
| Voir et gérer **ce document uniquement** | lire la colonne A, écrire les statuts. Les autres fichiers de votre Drive sont hors de portée |
| Afficher et exécuter du contenu web tiers | le menu, le dialogue des clés, le panneau latéral |
| Se connecter à un service externe | joindre `api.amazon.com` et `sellingpartnerapi-eu.amazon.com`, et rien d'autre |

## Utilisation

**1. Renseigner la configuration** (onglet « Paramètres », créé au premier clic du menu)

- Menu → **Saisir / modifier les clés** : `client_id`, `client_secret`, `refresh_token` de votre
  application SP-API. Les champs sont masqués et toujours vides à l'ouverture ; laisser un champ
  vide conserve la clé déjà enregistrée. L'onglet n'affiche jamais qu'« enregistrée » ou
  « manquante ».
- Saisissez votre **Seller ID** (B4) et choisissez la **marketplace** (B5) dans la liste.
- Menu → **Tester la connexion** : le résultat et sa date s'écrivent dans l'onglet. En cas d'échec,
  le message indique quoi corriger (par exemple `refresh_token` expiré).

**2. Coller les ASINs**

Dans l'onglet « ASINs », collez vos ASINs en **colonne A**, à partir de la ligne 2. Les colonnes
B, C et D sont remplies par le script — n'y écrivez rien. La casse et les espaces n'ont pas
d'importance ; votre saisie n'est jamais réécrite.

**3. Lancer la vérification**

Menu → **Ouvrir le panneau**, puis **Lancer / Reprendre**. Le panneau affiche les compteurs par
statut, une barre de progression et les dernières lignes traitées.

Une vérification longue est découpée automatiquement en plusieurs passages (limite d'exécution de
Google) : le panneau les enchaîne sans intervention. **Arrêter** interrompt proprement après
l'ASIN en cours ; **Lancer / Reprendre** repart exactement où ça s'était arrêté.

<!-- capture à ajouter : docs/img/panneau.png -->

L'entrée de menu **Vérifier les ASINs** fait le même travail, mais sans enchaînement : sur une
longue liste, il faut la relancer à la main à chaque passage. Le panneau est préférable.

**4. Lire les résultats**

| Statut (colonne B) | Signification |
|---|---|
| `ELIGIBLE` | vendable en neuf |
| `APPROVAL_REQUIRED` | vendable après autorisation d'Amazon (un lien de demande existe) |
| `NOT_ELIGIBLE` | vente en neuf refusée |
| `NOT_FOUND` | ASIN inconnu sur cette marketplace |
| `INVALID_ASIN` | ce n'est pas un ASIN (format attendu : 10 caractères, lettres et chiffres) |
| `ERROR` | échec passager (réseau, quota, incident Amazon) — à relancer |

La colonne C donne le code de restriction renvoyé par Amazon, la colonne D la date de vérification.

<!-- capture à ajouter : docs/img/asins.png -->

Menu → **Créer / réparer le Récap** crée un onglet « Récap » : nombre et pourcentage par statut,
total, reste à traiter, date du dernier passage.

<!-- capture à ajouter : docs/img/recap.png -->

## À savoir

- **Ne renommez pas les onglets** « ASINs », « Paramètres » et « Récap » : le script les retrouve
  par leur nom et en recréerait un vide.
- L'onglet **« Récap » est entièrement généré** par le script. « Créer / réparer le Récap » le
  réécrit de zéro : n'y saisissez rien, ce serait perdu.
- **Fermer le panneau** (ou le classeur) arrête l'enchaînement après le passage en cours. Les
  lignes déjà vérifiées sont conservées ; « Lancer / Reprendre » continue.
- Une ligne **`ERROR` est réessayée une seule fois par lancement**. Si elle ressort `ERROR`, la
  vérification se termine au lieu de tourner en boucle — relancez plus tard.
- Les autres statuts sont **définitifs** : ils ne sont jamais réinterrogés. Pour tout revérifier,
  menu → **Effacer les résultats** (vide B, C et D ; la colonne A est conservée).
- Les couleurs des lignes sont de la mise en forme conditionnelle. Menu → **Appliquer les
  couleurs** les remet en place si elles ont été effacées.

---

# Pour un développeur

Le code vit dans `src/` et se synchronise avec le projet Apps Script via
[clasp](https://github.com/google/clasp). Le script est **lié à un classeur** (container-bound) :
il n'existe pas sans lui, et il faut donc commencer par créer le couple classeur + script.

```bash
npm install -g @google/clasp
clasp login                            # une fois par machine
```

1. Créez un **Google Sheet** (ce sera le classeur modèle, ou votre classeur de test).
2. Dans ce classeur : **Extensions → Apps Script**. Un projet vide est créé et rattaché au
   classeur.
3. Dans l'éditeur : **Paramètres du projet** (roue dentée) → copiez l'**ID du script**.
4. À la racine du dépôt :

   ```bash
   cp .clasp.json.example .clasp.json
   ```

   puis remplacez `REMPLACER_PAR_LE_SCRIPT_ID` par l'ID copié. `rootDir` doit rester `"src"` :
   c'est ce qui fait que seul `src/` est poussé, et que `tests/` ne part jamais vers Apps Script.
5. Envoyez le code :

   ```bash
   clasp push                           # envoie src/ vers le script
   clasp open                           # ouvre l'éditeur Apps Script
   ```

6. Rechargez le classeur : le menu « ASIN Checker » apparaît.

`clasp push` écrase la version en ligne, **`appsscript.json` compris** — donc le manifeste, ses
scopes OAuth et le runtime. Toute modification faite directement dans l'éditeur (par vous ou par
un client) est perdue : à n'exécuter que délibérément, et `clasp pull` d'abord en cas de doute.

`.clasp.json` et `.clasprc.json` ne sont **pas versionnés** (ils contiennent l'identifiant du
classeur et vos jetons Google) : chacun crée les siens à partir de `.clasp.json.example`.

Les tests tournent hors Apps Script, sans dépendance :

```bash
node tests/classify.js     # 206 assertions
```

Ils couvrent les fonctions pures (classification des réponses SP-API, sélection des lignes à
traiter, formules du Récap, couleurs). Tout ce qui touche `SpreadsheetApp`, `UrlFetchApp`,
`LockService` ou `PropertiesService` est vérifié par la checklist manuelle.

**[CLAUDE.md](CLAUDE.md)** est la référence technique : rôle de chaque fichier, mécanique d'un
run, règles de non-fuite des secrets, checklist de vérification manuelle. À lire avant toute
modification.

## Sécurité

- Les trois clés SP-API vivent **uniquement** dans les propriétés du script
  (`PropertiesService`), jamais dans une cellule, un log, un message d'erreur ni le dépôt.
  Une seule fonction privée les lit, pour demander un jeton d'accès à Amazon.
- Le jeton d'accès reste interne : il ne sort que dans l'en-tête de la requête SP-API.
- Du corps des réponses Amazon, le script n'extrait que le strict nécessaire (jeton, code
  d'erreur, restrictions) ; les messages affichés viennent d'une liste fermée.
- **Copier le classeur ne copie pas les propriétés du script** : chaque copie part sans clés, et
  son utilisateur doit saisir les siennes. C'est voulu.
- Limite à connaître : les propriétés du script sont lisibles par quiconque peut ouvrir
  l'éditeur Apps Script de **sa** copie. Les clés sont protégées de la feuille, pas d'un
  utilisateur qui a déjà accès au script.

## Limites connues

- Marketplaces européennes uniquement (host `sellingpartnerapi-eu.amazon.com`).
- La restriction est évaluée pour l'état **neuf** ; les conditions `used_*`, `collectible_*` et
  `refurbished_*` sont ignorées.
- Cadence fixée à ~4 requêtes/seconde : comptez **environ 10 minutes pour 1 000 ASINs**
  (mesuré : 624 ASINs en ~6 minutes).
- Aucun déclencheur programmé : une vérification démarre toujours par un clic.
- Une seule vérification à la fois par classeur (verrou) ; un second lancement est refusé avec un
  message.
- Les statuts ne sont pas traduits : ce sont les valeurs renvoyées par Amazon.
