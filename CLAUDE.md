# asin-checker-sheets

Add-on Google Sheets (Apps Script, runtime **V8**, synchronisé par **clasp**) qui vérifie si des
ASINs sont vendables sur Amazon via SP-API `GET /listings/2021-08-01/restrictions`
(host `sellingpartnerapi-eu.amazon.com`).

Le script est livré à des clients : **chacun utilise ses propres clés SP-API**, saisies dans sa
copie du classeur. Rien n'est mutualisé, aucun secret n'est versionné.

État actuel : **étape 2** — onglet « Paramètres » et clés (étape 1), plus l'onglet « ASINs »
et la vérification par lots. L'étape 3 (mise en forme conditionnelle, sidebar, onglet Récap)
n'est pas implémentée.

## Structure

| Fichier | Responsabilité |
|---|---|
| `src/appsscript.json` | Manifeste : runtime V8, fuseau, scopes OAuth minimaux |
| `src/Menu.gs` | Menu « ASIN Checker » dans `onOpen` (et rien d'autre) : deux groupes d'entrées |
| `src/Config.gs` | Constantes partagées (`APP_NAME`, `CELLS`, `MARKETPLACES`), onglet « Paramètres », `showToast_()` |
| `src/Keys.gs` | Seul fichier qui touche aux clés (PropertiesService) : enregistrement, statuts, effacement |
| `src/KeysUi.gs` | Ouverture du dialogue `HtmlService` (nom distinct de `KeysDialog.html` : voir ci-dessous) |
| `src/KeysDialog.html` | Formulaire de saisie, champs masqués, CSS/JS inline |
| `src/Lwa.gs` | Échange `refresh_token` → jeton d'accès sur `api.amazon.com`, et cache du jeton |
| `src/Validation.gs` | `validateSettings_()` : la configuration est-elle complète ? (deux appelants) |
| `src/ConnectionTest.gs` | Test de connexion LWA, rendu OK/KO dans l'onglet « Paramètres » |
| `src/Asins.gs` | Onglet « ASINs » : mise en page, lignes à traiter, écriture des résultats, effacement |
| `src/Restrictions.gs` | Appel SP-API `restrictions` + classification du statut |
| `src/AsinCheck.gs` | Orchestration d'un run : cadence, budget temps, reprise |
| `tests/classify.js` | Tests de la logique de décision, exécutés par `node` (hors Apps Script) |

`Config.gs` ne dépend d'aucun autre fichier. Les dépendances vont dans un seul sens :
`Menu` → `KeysUi`/`ConnectionTest`/`AsinCheck` → `Validation`/`Asins`/`Restrictions` →
`Keys`/`Lwa` → `Config`.

**Nommage des fichiers** : Apps Script identifie les fichiers par leur nom *sans extension*.
Deux fichiers ne peuvent donc pas s'appeler `Foo.gs` et `Foo.html` — `clasp push` échoue avec
« A file with this name already exists ». D'où `KeysUi.gs` à côté de `KeysDialog.html`.

## Scopes OAuth (`src/appsscript.json`)

- `spreadsheets.currentonly` — lire/écrire **uniquement le classeur conteneur**. Choisi à la
  place de `.../auth/spreadsheets`, qui donnerait accès à tous les Sheets du client.
- `script.container.ui` — menu, dialogue modal, toasts.
- `script.external_request` — `UrlFetchApp` vers `api.amazon.com` et `sellingpartnerapi-eu.amazon.com`.

`PropertiesService` et `CacheService` ne demandent aucun scope. N'ajouter un scope que si une API le refuse
explicitement — et le justifier ici.

## Onglet « ASINs »

```
     A        B        C                  D
1    ASIN     Statut   Code restriction   Vérifié le     (en-têtes, ligne figée)
2…   saisie   script   script             script
```

**La colonne B est le marqueur d'avancement** : une ligne dont A est renseignée et dont B est
**vide ou vaut `ERROR`** reste à vérifier (`isPendingStatus_` dans `Asins.gs`). C'est tout le
mécanisme de reprise — un run qui s'arrête en cours de route laisse les lignes non traitées avec
B vide, et la relance les reprend sans trou ni doublon. Ne pas remplacer ce marqueur par un
compteur ou une propriété.

`ERROR` est le **seul statut transitoire** : il vient d'une cause passagère (réseau, backoff 429
épuisé, 5xx, réponse illisible) et est donc relancé automatiquement au run suivant. `ELIGIBLE`,
`NOT_ELIGIBLE`, `APPROVAL_REQUIRED`, `NOT_FOUND` et `INVALID_ASIN` sont **définitifs** et ne sont
jamais réinterrogés — seul « Effacer les résultats » les remet en jeu. Conséquence à garder en tête si
un nouveau statut est ajouté : tout statut non listé dans `isPendingStatus_` est définitif.

Un run s'arrête de lui-même après `MAX_RUN_MILLIS` (4 min 30, `AsinCheck.gs`) pour rester sous la
limite d'exécution d'Apps Script, et écrit ses résultats dans un `finally` — une interruption ne
perd jamais ce qui a déjà été vérifié. Cadence `REQUEST_INTERVAL_MILLIS` = 250 ms (~4 req/s) ;
un 429 déclenche le backoff `BACKOFF_MILLIS` (1, 2, 4, 8 s) puis rend `ERROR` / `HTTP 429`.

La colonne A n'est **jamais** réécrite : `normalizeAsin_()` (trim + majuscules) ne sert qu'à
construire la requête.

Classification (`classifyRestrictions_` dans `Restrictions.gs`) :

| Réponse | Statut |
|---|---|
| `restrictions` absent ou vide | `ELIGIBLE` |
| que des `conditionType` hors `new*` (`used_*`, `collectible_*`, `refurbished_*`) | `ELIGIBLE` |
| `conditionType` en `new*` (ou absent) avec un `links` non vide | `APPROVAL_REQUIRED` |
| `conditionType` en `new*` (ou absent) sans `links` | `NOT_ELIGIBLE` |
| HTTP 400 | `INVALID_ASIN` (ASIN mal formé ou refusé en entrée) |
| HTTP 404 | `NOT_FOUND` |
| HTTP 401 / 403 | **arrêt du run**, aucun statut écrit |
| tout autre échec | `ERROR`, code HTTP seul |

**Arrêt sur 401/403** : la cause est globale (jeton refusé, Seller ID, droits de l'application),
pas propre à un ASIN — écrire `ERROR` sur chaque ligne polluerait toute la liste et brûlerait du
quota pour rien. `toOutcome_` renvoie alors `{ fatal: true, httpCode }`, un objet qui ne porte ni
`status` ni `code` : par construction il ne peut pas atteindre une cellule. `runChecks_` appelle
`clearCachedToken_()`, sort de la boucle **sans** pousser de résultat — la ligne en cours et les
suivantes gardent leur colonne B — et le `finally` écrit quand même ce qui a déjà été vérifié.
L'alerte finale vient de l'allowlist `RUN_FATAL_MESSAGES` : 401 = clés à vérifier, 403 = Seller ID
ou droits de l'application.

Sur un **401 uniquement**, une seule nouvelle tentative est faite avec un jeton frais
(`checkAsinWithRefresh_`) : le jeton en cache peut simplement avoir expiré. Le drapeau
`state.tokenRefreshed` est porté par le **run** et non par l'ASIN — une fois le jeton renouvelé,
un nouveau 401 signifie que les clés sont réellement refusées, et réessayer ne ferait que
retarder l'arrêt.

Trois pièges à ne pas réintroduire :

1. Les `links` sont portés par `restrictions[i].reasons[j].links`, **pas** par `restrictions[i]`.
2. Une entrée sans `conditionType` s'applique à toutes les conditions, `new` comprise : l'écarter
   ferait remonter `ELIGIBLE` à tort, c'est l'erreur coûteuse pour un revendeur.
3. `conditionType` se teste sur le **préfixe** `new`, jamais par égalité. Amazon ne renvoie jamais
   `new` seul mais des valeurs déclinées : `new_new`, `new_open_box`, `new_oem`… Une égalité
   stricte ne matche aucune d'elles, donc toute restriction sur du neuf ressortirait `ELIGIBLE` —
   le bug exact corrigé dans `appliesToNewCondition_`. Les `used_*`, `collectible_*` et
   `refurbished_*` restent écartées par ce même préfixe.

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
5. `Lwa.gs` n'extrait du corps de réponse que deux champs : `access_token` en cas de succès,
   `error` en cas d'échec — ce dernier affiché via l'allowlist `LWA_ERROR_MESSAGES`. Aucun corps
   de réponse ni texte d'exception n'est affiché brut.
6. Le jeton d'accès est à **usage interne strict**. Il ne vit que dans la valeur de retour de
   `requestAccessToken_()`/`getAccessToken_()`, dans le `context` local d'un run
   (`AsinCheck.gs`) et dans l'en-tête `x-amz-access-token` (`Restrictions.gs`). Jamais une
   cellule, un log, un toast, un message d'erreur. `testConnection()` l'ignore et n'utilise pas
   le cache : tester la connexion doit réellement interroger Amazon.
7. Toute modification (`saveKeys`) ou effacement (`clearKeys`) des clés appelle
   `clearCachedToken_()`. Sans cela, un jeton obtenu avec les anciennes clés resterait utilisable
   jusqu'à 50 minutes.
8. Le corps d'erreur SP-API n'est ni lu ni affiché : la colonne C ne reçoit que le code HTTP, et
   les messages d'arrêt sur 401/403 viennent de l'allowlist `RUN_FATAL_MESSAGES`.
9. Le dialogue ne reçoit jamais de valeur : seuls des booléens de présence sont injectés, donc
   les champs sont toujours vides à l'ouverture. Un champ vide = clé inchangée.
10. `.clasp.json` et `.clasprc.json` ne sont pas versionnés (voir `.gitignore`) ;
    `.clasp.json.example` sert de modèle.

**Limite à communiquer aux clients** : les propriétés du script et le cache de script sont
lisibles par quiconque a accès à l'éditeur Apps Script de **sa** copie du classeur. Les clés et
le jeton sont protégés de la surface Sheet, pas d'un utilisateur de niveau éditeur.

## Conventions de code

- Runtime V8, pas de dépendance externe, pas de build.
- Constantes `UPPER_SNAKE_CASE` en haut de fichier, déclarées en `var` : c'est la forme fiable
  pour un global partagé entre fichiers `.gs`. Une constante d'un autre fichier ne se lit
  qu'à l'intérieur d'une fonction, jamais au niveau racine (l'ordre de chargement n'est pas
  garanti) — voir `APP_NAME` lu dans `onOpen`.
- Fonctions privées suffixées `_` (non appelables depuis le menu ni depuis `google.script.run`).
  **Une fonction globale est une cible de menu ou de `google.script.run`, point.** Soit, à ce
  jour : `onOpen`, `showKeysDialog`, `testConnection`, `clearKeys`, `checkAsins`,
  `clearAsinResults` (menu) et `saveKeys`, `getKeyStatuses` (dialogue). Ne pas en ajouter d'autres.
- Deux fichiers `.gs` partagent le même espace de noms global : vérifier qu'une nouvelle
  constante `UPPER_SNAKE_CASE` n'existe pas déjà ailleurs (`grep -rn "^var NOM" src/`).
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

## Tests automatiques

```bash
node tests/classify.js     # 38 assertions, sortie non nulle en cas d'échec
```

Couvre la logique pure de décision : `classifyRestrictions_`, `toOutcome_` et
`isPendingStatus_`. Le harnais charge `src/Asins.gs` et `src/Restrictions.gs` dans une portée
isolée (`Function.apply`), donc **aucun stub à maintenir** et aucune duplication de la logique
testée.

`tests/fixtures/B0CHXMX9XC.json` est une réponse SP-API **réelle** (marketplace FR, capturée le
10/11/2026), conservée telle quelle. Elle déclare dix conditions dont une seule en `new_new` :
c'est précisément le cas qui a révélé le bug, puisqu'une égalité stricte sur `new` rendait
`ELIGIBLE` un ASIN restreint dans toutes ses conditions. Deux assertions vérifient que la fixture
garde son pouvoir discriminant (une condition `new_*` déclinée, et des `links` hors `new_*`) : une
capture future qui perdrait ces propriétés ferait passer le test sans plus rien démontrer.

Les fixtures sont des réponses d'API : ni clé, ni jeton, ni Seller ID. Avant d'en committer une,
relire les `links[].resource` — ce sont les seuls champs susceptibles de porter des paramètres de
compte (ceux de cette capture ne contiennent que l'ASIN).

À lancer après toute modification de `Restrictions.gs` ou des statuts. Réintroduire l'égalité
stricte sur `conditionType` fait tomber 9 assertions sur 38 — barrière vérifiée par mutation.

Ce qui n'est **pas** testable ainsi — `SpreadsheetApp`, `UrlFetchApp`, `PropertiesService`,
`CacheService` — reste couvert par la checklist manuelle ci-dessous.

`tests/` n'est jamais poussé vers le projet Apps Script : `rootDir` vaut `src` dans
`.clasp.json`, ce que `clasp status` permet de confirmer.

## Vérification manuelle (rien ne s'exécute en local)

Contrôles statiques avant tout push :

```bash
node tests/classify.js                             # doit afficher 38/38
for f in src/*.gs; do cp "$f" "/tmp/$(basename "$f" .gs).js"; node --check "/tmp/$(basename "$f" .gs).js"; done
grep -rn "Logger\|console\." src/                 # doit être vide
grep -rn "PropertiesService" src/                  # doit ne citer que Keys.gs
grep -rn "accessToken" src/                        # Lwa.gs, AsinCheck.gs (context), Restrictions.gs (en-tête)
ls src | sed 's/\.[^.]*$//' | sort | uniq -d       # doit être vide (collision .gs / .html)
```

### Étape 1 — clés et connexion

1. `clasp push`, recharger le classeur → menu « ASIN Checker », cinq entrées en deux groupes.
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

### Étape 2 — vérification des ASINs

10. « Vérifier les ASINs » sans clés → alerte « Configuration incomplète », aucun appel réseau,
    et l'onglet « ASINs » est créé avec ses quatre en-têtes et la ligne 1 figée.
11. Avec une configuration valide, quatre ASINs : un vendable, un soumis à approbation, un
    inexistant (`B000000000`) et un mal formé (`XXX`) → `ELIGIBLE` / `APPROVAL_REQUIRED` /
    `NOT_FOUND` / `INVALID_ASIN` (ce dernier si Amazon répond 400), le `reasonCode` en colonne C
    et l'horodatage en D. Noter que les quatre statuts sont définitifs : aucun n'est repris au
    run suivant.
12. Relancer « Vérifier les ASINs » → toast « Aucun ASIN à vérifier » : les lignes portant un
    statut **définitif** ne sont pas réinterrogées (vérifiable dans les journaux d'exécution,
    aucune requête). Vrai seulement si aucune ligne n'est en `ERROR`.
13. Ajouter un ASIN en bas de la liste, relancer → seule la nouvelle ligne est interrogée, les
    valeurs précédentes sont intactes.
14. Insérer un ASIN **entre** deux lignes déjà traitées, relancer → seule cette ligne est
    remplie ; ses voisines ne sont pas réécrites (découpage en blocs de `writeResults_`).
15. Coller ~400 ASINs → le run s'arrête avant 5 min, le toast annonce le nombre restant, et une
    relance reprend exactement où ça s'était arrêté, sans trou ni doublon.
16. Saisir un ASIN en minuscules avec des espaces → il est interrogé correctement (normalisation)
    et la cellule de la colonne A reste telle qu'elle a été saisie.
17. « Effacer les résultats » → **Non** ne change rien ; **Oui** vide B:D, tandis que la colonne
    A et la ligne d'en-têtes restent intactes.
18. Après « Effacer les clés », relancer « Vérifier les ASINs » → alerte « Configuration
    incomplète » et **aucun** appel SP-API : le jeton en cache a bien été purgé.
19. **Reprise d'un `ERROR`** : taper `ERROR` à la main dans une cellule B déjà remplie, puis
    relancer → cette seule ligne est réinterrogée, son statut est remplacé, le toast annonce
    « … relancé(s) après ERROR », et les lignes portant un statut définitif restent intactes.
    C'est la façon fiable de tester la reprise : un vrai `ERROR` dépend d'une panne réseau ou
    d'un 5xx, qu'on ne provoque pas à la demande.
20. **Arrêt sur 403** : garder de **vraies** clés fonctionnelles et mettre un Seller ID erroné en
    B4 de l'onglet « Paramètres » → le run s'arrête au **premier** ASIN, alerte « Accès refusé par
    Amazon (HTTP 403) », et **aucune** ligne ne reçoit de statut : la colonne B reste vide
    partout. Les journaux d'exécution montrent un seul appel SP-API, pas un par ASIN.
    De fausses clés ne testent **pas** ce chemin : LWA refuse le jeton avant le premier ASIN et
    l'alerte est « Authentification Amazon », pas un arrêt 401/403.
    Le chemin **401** n'est pas provoquable proprement (il faudrait un jeton accordé par LWA puis
    refusé par SP-API) : il se vérifie par relecture du code — branche 401 de `toOutcome_`
    (`Restrictions.gs`) et tentative unique de `checkAsinWithRefresh_` (`AsinCheck.gs`).
21. Journaux d'exécution et cellules : aucun fragment de clé ni de jeton.
22. **Non-régression `conditionType`** : `B0CHXMX9XC` doit donner `APPROVAL_REQUIRED`. Sa réponse
    contient une restriction en `new_new` avec des `links` dans `reasons[]` : si ce test ressort
    `ELIGIBLE`, c'est que la comparaison de `conditionType` est redevenue une égalité stricte au
    lieu d'un test de préfixe.
