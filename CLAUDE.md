# asin-checker-sheets

Add-on Google Sheets (Apps Script, runtime **V8**, synchronisé par **clasp**) qui vérifie si des
ASINs sont vendables sur Amazon via SP-API `GET /listings/2021-08-01/restrictions`
(host `sellingpartnerapi-eu.amazon.com`).

Le script est livré à des clients : **chacun utilise ses propres clés SP-API**, saisies dans sa
copie du classeur. Rien n'est mutualisé, aucun secret n'est versionné.

État actuel : **étape 1** — onglet « Paramètres », gestion des clés, test de connexion LWA.
La vérification d'ASINs (étape 2) n'est pas implémentée.

## Structure

| Fichier | Responsabilité |
|---|---|
| `src/appsscript.json` | Manifeste : runtime V8, fuseau, scopes OAuth minimaux |
| `src/Menu.gs` | Menu « ASIN Checker » dans `onOpen` (et rien d'autre) : trois entrées |
| `src/Config.gs` | Constantes partagées (`APP_NAME`, `CELLS`, `MARKETPLACES`), onglet « Paramètres », `showToast_()` |
| `src/Keys.gs` | Seul fichier qui touche aux clés (PropertiesService) : enregistrement, statuts, effacement |
| `src/KeysUi.gs` | Ouverture du dialogue `HtmlService` (nom distinct de `KeysDialog.html` : voir ci-dessous) |
| `src/KeysDialog.html` | Formulaire de saisie, champs masqués, CSS/JS inline |
| `src/Lwa.gs` | Échange `refresh_token` → jeton d'accès sur `api.amazon.com` |
| `src/ConnectionTest.gs` | Validation de la configuration + test de connexion, rendu OK/KO |

`Config.gs` ne dépend d'aucun autre fichier. Les dépendances vont dans un seul sens :
`Menu` → `KeysUi`/`ConnectionTest` → `Keys`/`Lwa` → `Config`.

**Nommage des fichiers** : Apps Script identifie les fichiers par leur nom *sans extension*.
Deux fichiers ne peuvent donc pas s'appeler `Foo.gs` et `Foo.html` — `clasp push` échoue avec
« A file with this name already exists ». D'où `KeysUi.gs` à côté de `KeysDialog.html`.

## Scopes OAuth (`src/appsscript.json`)

- `spreadsheets.currentonly` — lire/écrire **uniquement le classeur conteneur**. Choisi à la
  place de `.../auth/spreadsheets`, qui donnerait accès à tous les Sheets du client.
- `script.container.ui` — menu, dialogue modal, toasts.
- `script.external_request` — `UrlFetchApp` vers `api.amazon.com` (et `sellingpartnerapi-eu.amazon.com` à l'étape 2).

`PropertiesService` ne demande aucun scope. N'ajouter un scope que si une API le refuse
explicitement — et le justifier ici.

## Règles secrets (non négociables)

1. Les clés (`client_id`, `client_secret`, `refresh_token`) vivent **uniquement** dans les
   propriétés du script (`PropertiesService.getScriptProperties()`).
2. Jamais de valeur ni de fragment de valeur dans une cellule, un `Logger.log`, un `toast`,
   un message d'erreur, un commit ou le retour d'une fonction appelée depuis le HTML.
   L'onglet « Paramètres » n'affiche que « enregistrée » / « manquante ».
3. Une seule fonction lit les valeurs : `getCredentials_()` dans `src/Keys.gs`. Elle est privée
   et sert uniquement à `requestAccessToken_()`. Ne pas l'appeler ailleurs.
4. L'effacement (`deleteStoredKeys_()`) supprime les trois propriétés une par une via
   `deleteProperty`. **Ne pas utiliser `deleteAllProperties()`** : les autres propriétés du
   script, actuelles ou futures, ne doivent pas être emportées. L'effacement ne touche ni le
   nom du vendeur, ni le Seller ID, ni la marketplace (qui vivent dans la feuille, pas dans
   les propriétés). En revanche il remet à blanc le bloc « Test de connexion »
   (`clearTestResult_()`) : un « OK » laissé en place après un effacement serait trompeur.
5. `Lwa.gs` ne lit pas le corps de la réponse en cas de succès (il contient le jeton) et, en cas
   d'échec, n'en extrait que le champ `error`, affiché via l'allowlist `LWA_ERROR_MESSAGES`.
   Aucun corps de réponse ni texte d'exception n'est affiché brut.
6. Le dialogue ne reçoit jamais de valeur : seuls des booléens de présence sont injectés, donc
   les champs sont toujours vides à l'ouverture. Un champ vide = clé inchangée.
7. `.clasp.json` et `.clasprc.json` ne sont pas versionnés (voir `.gitignore`) ;
   `.clasp.json.example` sert de modèle.

**Limite à communiquer aux clients** : les propriétés du script sont lisibles par quiconque a
accès à l'éditeur Apps Script de **sa** copie du classeur. Les clés sont protégées de la surface
Sheet, pas d'un utilisateur de niveau éditeur.

## Conventions de code

- Runtime V8, pas de dépendance externe, pas de build.
- Constantes `UPPER_SNAKE_CASE` en haut de fichier, déclarées en `var` : c'est la forme fiable
  pour un global partagé entre fichiers `.gs`. Une constante d'un autre fichier ne se lit
  qu'à l'intérieur d'une fonction, jamais au niveau racine (l'ordre de chargement n'est pas
  garanti) — voir `APP_NAME` lu dans `onOpen`.
- Fonctions privées suffixées `_` (non appelables depuis le menu ni depuis `google.script.run`).
  Seules `onOpen`, `showKeysDialog`, `testConnection`, `clearKeys`, `ensureSettingsSheet`,
  `saveKeys` et `getKeyStatuses` sont globales — c'est voulu, ne pas en ajouter sans raison.
- Identifiants et commentaires : identifiants en anglais, commentaires et textes affichés en
  français.
- Fonctions courtes, une responsabilité par fichier.

## Commandes clasp

```bash
npm install -g @google/clasp     # une fois
clasp login                      # une fois par machine

cp .clasp.json.example .clasp.json   # puis renseigner le scriptId du classeur
clasp clone <scriptId> --rootDir src # alternative : récupérer un script existant

clasp push                       # envoie src/ vers le script
clasp open                       # ouvre l'éditeur Apps Script
clasp pull                       # récupère les modifications faites dans l'éditeur
```

**Ne jamais lancer `clasp push` sans demande explicite** : le push écrase la version en ligne,
qui peut contenir des modifications faites directement dans l'éditeur par le client.

## Vérification manuelle (rien ne s'exécute en local)

1. `clasp push`, recharger le classeur → menu « ASIN Checker », **trois** entrées.
2. « Saisir / modifier les clés » → trois champs masqués et vides ; enregistrer une seule clé →
   cette ligne passe à « enregistrée » dans l'onglet, les autres restent « manquante ».
3. « Tester la connexion » sans Seller ID → KO « Configuration incomplète », sans appel réseau.
4. Clés erronées → KO avec le message `invalid_client` ou `invalid_grant` correspondant.
5. Vraies clés → OK + horodatage.
6. « Effacer les clés » → la confirmation OUI/NON décrit ce qui va être supprimé, sans afficher
   de valeur. Répondre **Non** (ou fermer) → toast « Effacement annulé », les trois statuts
   restent « enregistrée » et le résultat du dernier test est conservé. Répondre **Oui** → les
   trois statuts passent à « manquante », les cellules B13:B15 (résultat, détail, date) sont
   vides, tandis que le nom du vendeur (B3), le Seller ID (B4) et la marketplace (B5) sont
   intacts.
7. Après effacement, « Tester la connexion » → KO « Configuration incomplète : clé(s)
   manquante(s) : client_id, client_secret, refresh_token … », sans appel réseau.
8. Vérifier dans l'éditeur (Paramètres du projet → Propriétés du script) que les trois clés ont
   bien disparu et qu'aucune autre propriété n'a été supprimée.
9. Relire les cellules d'état et les journaux d'exécution : aucun fragment de clé.
