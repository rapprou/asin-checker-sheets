# asin-checker-sheets

Add-on Google Sheets (Apps Script, runtime **V8**, synchronisé par **clasp**) qui vérifie si des
ASINs sont vendables sur Amazon via SP-API `GET /listings/2021-08-01/restrictions`
(host `sellingpartnerapi-eu.amazon.com`).

Le script est livré à des clients : **chacun utilise ses propres clés SP-API**, saisies dans sa
copie du classeur. Rien n'est mutualisé, aucun secret n'est versionné.

État actuel : **étape 3 terminée** — clés et connexion (1), onglet « ASINs » et vérification (2),
couleurs par statut, onglet « Récap » et panneau de pilotage (3). Validé en réel : **624 ASINs en
2 tranches**, arrêt en cours de 2ᵉ tranche puis reprise sans trou ni doublon.

## Structure

| Fichier | Responsabilité |
|---|---|
| `src/appsscript.json` | Manifeste : runtime V8, fuseau, scopes OAuth minimaux |
| `src/Menu.gs` | Menu « ASIN Checker » dans `onOpen` (et rien d'autre) : trois groupes d'entrées |
| `src/Config.gs` | Constantes partagées (`APP_NAME`, `CELLS`, `MARKETPLACES`), onglet « Paramètres », `showToast_()` |
| `src/Keys.gs` | Seul fichier qui touche aux clés (PropertiesService) : enregistrement, statuts, effacement |
| `src/KeysUi.gs` | Ouverture du dialogue `HtmlService` (nom distinct de `KeysDialog.html` : voir ci-dessous) |
| `src/KeysDialog.html` | Formulaire de saisie, champs masqués, CSS/JS inline |
| `src/Lwa.gs` | Échange `refresh_token` → jeton d'accès sur `api.amazon.com`, et cache du jeton |
| `src/Validation.gs` | `validateSettings_()` : la configuration est-elle complète ? (deux appelants) |
| `src/ConnectionTest.gs` | Test de connexion LWA, rendu OK/KO dans l'onglet « Paramètres » |
| `src/Asins.gs` | Onglet « ASINs » : mise en page, sélection des lignes à traiter, écriture des résultats, comptes par statut |
| `src/Statuses.gs` | **Source unique** de l'affichage des statuts : ordre et couleurs (`statusStyles_`, `statusList_`, `statusStyle_`) |
| `src/Formatting.gs` | Mise en forme conditionnelle par statut sur `ASINs!A2:D`, idempotente |
| `src/Summary.gs` | Onglet « Récap » : formules seules, détection du séparateur d'arguments |
| `src/Restrictions.gs` | Appel SP-API `restrictions` + classification du statut |
| `src/RunControl.gs` | Chaîne de runs : drapeau d'arrêt (cache) et `chainStart` (`resolveChainStart_`) |
| `src/AsinCheck.gs` | Cœur d'un run : cadence, budget temps, écriture par paquets, compte-rendu |
| `src/Sidebar.gs` | Points d'entrée du panneau (`showSidebar`, `runFromSidebar`, `getCounters`, `stopRun`) |
| `src/SidebarPanel.html` | Panneau : compteurs, barre de progression, boutons, journal, enchaînement des tranches |
| `tests/classify.js` | Tests des fonctions pures, exécutés par `node` (hors Apps Script) |

`Config.gs` et `Statuses.gs` ne dépendent d'aucun autre fichier (hors `ASIN_STATUS`, lu dans une
fonction). Les dépendances vont dans un seul sens : `Menu` → `KeysUi`/`ConnectionTest`/`Sidebar`/
`AsinCheck`/`Formatting`/`Summary` → `Validation`/`Asins`/`Restrictions`/`RunControl` →
`Keys`/`Lwa` → `Config`/`Statuses`.

**Nommage des fichiers** : Apps Script identifie les fichiers par leur nom *sans extension*.
Deux fichiers ne peuvent donc pas s'appeler `Foo.gs` et `Foo.html` — `clasp push` échoue avec
« A file with this name already exists ». D'où `KeysUi.gs` à côté de `KeysDialog.html`, et
`Sidebar.gs` à côté de `SidebarPanel.html`.

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

Les couleurs de la colonne B viennent de règles de **mise en forme conditionnelle** posées sur
`A2:D` (`Formatting.gs`), jamais d'un `setBackground` par cellule : une ligne se recolore dès que
son statut change, et « Effacer les résultats » la rend blanche sans travail. Nos règles sont
reconnues à leur formule (`=$B<ligne>="<STATUT>"`, n'importe quel numéro de ligne) puis réécrites,
donc une relance ne duplique rien et ne touche pas aux règles posées à la main par le client.

La colonne A n'est **jamais** réécrite : `normalizeAsin_()` (trim + majuscules) ne sert qu'à
construire la requête.

Classification (`classifyRestrictions_` dans `Restrictions.gs`) :

| Réponse | Statut |
|---|---|
| ASIN hors `^[A-Z0-9]{10}$` — **validé en local, aucun appel** | `INVALID_ASIN`, code `FORMAT` |
| `restrictions` absent ou vide | `ELIGIBLE` |
| que des `conditionType` hors `new*` (`used_*`, `collectible_*`, `refurbished_*`) | `ELIGIBLE` |
| un `reasonCode` vaut `ASIN_NOT_FOUND` (Amazon répond **200**) | `NOT_FOUND`, code `ASIN_NOT_FOUND` |
| `conditionType` en `new*` (ou absent) avec un `links` non vide | `APPROVAL_REQUIRED` |
| `conditionType` en `new*` (ou absent) sans `links` | `NOT_ELIGIBLE` |
| HTTP 404 | `NOT_FOUND` |
| HTTP 400 / 401 / 403 | **arrêt du run**, aucun statut écrit |
| tout autre échec | `ERROR`, code HTTP seul |

**Le format de l'ASIN est validé avant l'appel** (`isValidAsinFormat_`, `Restrictions.gs`), et
c'est ce qui rend le 400 interprétable : `XXX` donnerait `Invalid 'asin' provided.` et un Seller ID
erroné `Invalid 'sellerId' provided.`, deux 400 indiscernables sans lire le corps de réponse — ce
qu'on ne fait pas. Le filtre local retire le premier cas, donc un 400 qui remonte vient
nécessairement de la configuration. Sans ce découpage, un mauvais Seller ID marquait **toute la
liste** en `INVALID_ASIN`, un statut définitif, et sans aucune alerte.

Un ASIN inexistant ne donne **pas** 404 mais un **200** portant une restriction sans
`conditionType`, `reasonCode: ASIN_NOT_FOUND` et `links: []`. Sans traitement dédié il
ressortirait `NOT_ELIGIBLE` : l'entrée est retenue (pas de `conditionType`) et n'a pas de `links`.
Le test sur `ASIN_NOT_FOUND` passe donc **avant** la logique `links`. Le 404 reste traité, au cas
où l'API y revienne.

**Arrêt sur 400/401/403** : la cause est globale (Seller ID ou marketplace invalide, jeton
refusé, droits de l'application), pas propre à un ASIN — écrire un statut sur chaque ligne
polluerait toute la liste et brûlerait du quota pour rien. `toOutcome_` renvoie alors `{ fatal: true, httpCode }`, un objet qui ne porte ni
`status` ni `code` : par construction il ne peut pas atteindre une cellule. `runChecks_` appelle
`clearCachedToken_()`, sort de la boucle **sans** pousser de résultat — la ligne en cours et les
suivantes gardent leur colonne B — et le `finally` écrit quand même ce qui a déjà été vérifié.
L'alerte finale vient de l'allowlist `RUN_FATAL_MESSAGES` : 400 = Seller ID ou marketplace,
401 = clés à vérifier, 403 = droits de l'application.

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

## Un run : une chaîne de tranches

Une liste de plusieurs centaines d'ASINs dépasse la limite d'exécution d'Apps Script. Un run est
donc une **tranche** : `runAsinCheck_()` (`AsinCheck.gs`) n'affiche rien et rend
`{ end, checked, remaining, retried, undated, message, title, chainStart, lines }`.

| `end` | Sens | Suite |
|---|---|---|
| `done` | plus rien à traiter | fin |
| `timeout` | budget `MAX_RUN_MILLIS` épuisé | le panneau relance une tranche |
| `stopped` | drapeau d'arrêt lu | fin |
| `fatal` | config incomplète, verrou pris, LWA refusé, ou HTTP 400/401/403 | fin, message affiché |

Deux appelants : `checkAsins()` (menu) traduit le compte-rendu en alerte ou en toast, une seule
tranche ; `SidebarPanel.html` enchaîne tant que `end === 'timeout'` et cumule les totaux de la
chaîne — le serveur ne les connaît pas, chaque tranche étant une exécution distincte.

- **`chainStart` est fixé par le serveur**, jamais par le navigateur (`resolveChainStart_`). Au
  premier appel (`newChain: true`) il vaut `Date.now()` serveur et est rendu dans le compte-rendu ;
  le panneau le repasse **tel quel** aux tranches suivantes. Une ligne `ERROR` n'est reprise que si
  sa date (colonne D) lui est antérieure : **un `ERROR` n'est donc réessayé qu'une fois par
  chaîne**, et c'est tout ce qui empêche la boucle infinie. Laisser le client renvoyer son horloge
  faisait avancer la valeur de tranche en tranche et réessayait les mêmes `ERROR` sans fin.
  Une date illisible fait traiter la ligne comme ancienne, et elle est comptée (`undated`) puis
  signalée dans le bilan — le projet n'a **aucun logger**.
- **Verrou de script** (`LockService.getScriptLock()`, `tryLock` 1 s), pris avant la lecture des
  lignes et relâché dans un `finally` : deux runs simultanés se partageraient les mêmes lignes.
  Verrou pris → `fatal` avec un message clair.
- **Drapeau d'arrêt** en cache de script (TTL 10 min), lu à chaque itération. Effacé au démarrage
  d'une chaîne (**sous le verrou**, pour qu'un panneau refusé n'annule pas un « Arrêter » en cours)
  et quand un run s'est réellement arrêté dessus — jamais entre deux tranches. `stopRun()` ne prend
  pas le verrou : l'attendre ne rendrait la main qu'à la fin du run.
- **Écriture par paquets** : tous les `RESULT_FLUSH_SIZE` résultats, `writeResults_` puis
  `SpreadsheetApp.flush()`. Le vidage est indispensable — `getCounters()` est une *autre* exécution
  et ne verrait rien sans lui, donc la barre de progression resterait figée. Un compteur de lignes
  écrites empêche le `finally` de réécrire un paquet déjà posé.
- `getCounters()` (sondage ~5 s, seulement pendant un run) : une lecture de `A:B`, sans verrou ni
  appel SP-API.

Constantes de réglage, toutes en haut de `AsinCheck.gs` :

| Constante | Valeur | Rôle |
|---|---|---|
| `MAX_RUN_MILLIS` | 270000 | budget d'une tranche (4 min 30, sous la limite de 6 min) |
| `REQUEST_INTERVAL_MILLIS` | 250 | cadence ~4 req/s (quota SP-API `restrictions`) |
| `RESULT_FLUSH_SIZE` | 20 | résultats accumulés avant écriture |

Un 429 déclenche le backoff `BACKOFF_MILLIS` (1, 2, 4, 8 s, `Restrictions.gs`) puis rend
`ERROR` / `HTTP 429`.

## Onglet « Récap »

Créé et **réparé** par « Créer / réparer le Récap » (`ensureSummarySheet`) : le bloc `A:C` est
effacé puis réécrit, donc une ligne laissée par une version antérieure disparaît. Tout l'onglet
appartient au script, rien d'y saisir n'est conservé.

Il ne contient **que des formules** — aucun compte calculé par le script : les chiffres suivent
l'onglet « ASINs » en direct, et un Récap jamais régénéré reste juste. Les lignes de statuts sont
générées depuis `statusList_()`, les couleurs viennent de `statusStyle_()`.

Le **séparateur d'arguments suit la locale** du classeur : un Sheet français attend `;` et renvoie
`#ERROR!` sur une formule à virgules — `setFormula()` ne traduit rien (bug constaté en test réel).
Il n'existe aucune API pour le lire, donc `detectFormulaSeparator_()` le constate : une sonde
`=SUM(1<sép>1)` est écrite hors du tableau, `flush()`, et la valeur relue doit valoir 2. La cellule
sonde est vidée dans un `finally`, la détection a lieu **avant** l'effacement du bloc, et si aucun
séparateur ne passe elle lève — plutôt que de remplir le Récap de `#ERROR!`. Les constructeurs de
formules (`summaryPlan_` et ses aides) restent purs et reçoivent le séparateur en paramètre.

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
  `clearAsinResults`, `showSidebar`, `applyStatusFormatting`, `ensureSummarySheet` (menu),
  `saveKeys`, `getKeyStatuses` (dialogue) et `runFromSidebar`, `getCounters`, `stopRun`
  (panneau). Ne pas en ajouter d'autres.
- Les statuts et leurs couleurs ne se citent qu'à travers `Statuses.gs` : ajouter un statut à
  `ASIN_STATUS` sans lui donner de couleur fait tomber les tests.
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
node tests/classify.js     # 206 assertions, sortie non nulle en cas d'échec
```

Couvre **toutes les fonctions pures** du projet : classification (`classifyRestrictions_`,
`toOutcome_`, `isPendingStatus_`), couleurs et reconnaissance des règles (`statusStyles_`,
`isStatusFormatFormula_`), formules du Récap (`summaryPlan_`, vérifiées avec `,` **et** `;`),
sélection des lignes d'une chaîne (`selectPendingRows_`), `resolveChainStart_`, compteurs
(`countStatuses_`) et découpage des écritures (`unwrittenResults_`, `shouldFlush_`, `runEnd_`).

Le harnais charge les fichiers `src/*.gs` dans une portée isolée (`Function.apply`), donc **aucun
stub à maintenir** et aucune duplication de la logique testée. Les textes du panneau vivent dans
`SidebarPanel.html` et ne sont pas couverts : les vérifier avec `node --check` sur le `<script>`
extrait.

`tests/fixtures/B0CHXMX9XC.json` est une réponse SP-API **réelle** (marketplace FR, capturée le
10/11/2026), conservée telle quelle. Elle déclare dix conditions dont une seule en `new_new` :
c'est précisément le cas qui a révélé le bug, puisqu'une égalité stricte sur `new` rendait
`ELIGIBLE` un ASIN restreint dans toutes ses conditions. Deux assertions vérifient que la fixture
garde son pouvoir discriminant (une condition `new_*` déclinée, et des `links` hors `new_*`) : une
capture future qui perdrait ces propriétés ferait passer le test sans plus rien démontrer.

Les fixtures sont des réponses d'API : ni clé, ni jeton, ni Seller ID. Avant d'en committer une,
relire les `links[].resource` — ce sont les seuls champs susceptibles de porter des paramètres de
compte (ceux de cette capture ne contiennent que l'ASIN).

`tests/fixtures/B000000000.json` fige la réponse d'un ASIN inexistant : code 200,
`conditionType` absent, `reasonCode: ASIN_NOT_FOUND`. Sa forme est reconstituée d'après la réponse
constatée le 10/11/2026, pas capturée octet pour octet.

À lancer après toute modification de `Restrictions.gs`, des statuts ou de la logique de run.
Barrières vérifiées par mutation :

| Régression réintroduite | Assertions qui tombent |
|---|---|
| égalité stricte sur `conditionType` | 10 |
| `400` → `INVALID_ASIN` au lieu de fatal | 4 |
| suppression de la validation locale du format | 2 |
| `chainStart` refixé à chaque tranche | 3 |

Ce qui n'est **pas** testable ainsi — `SpreadsheetApp`, `UrlFetchApp`, `PropertiesService`,
`CacheService`, `LockService`, `HtmlService` — reste couvert par la checklist manuelle ci-dessous.

`tests/` n'est jamais poussé vers le projet Apps Script : `rootDir` vaut `src` dans
`.clasp.json`, ce que `clasp status` permet de confirmer.

## Vérification manuelle (rien ne s'exécute en local)

Contrôles statiques avant tout push :

```bash
node tests/classify.js                             # doit afficher 206/206
for f in src/*.gs; do cp "$f" "/tmp/$(basename "$f" .gs).js"; node --check "/tmp/$(basename "$f" .gs).js"; done
grep -rn "Logger\|console\." src/                 # doit être vide
grep -rn "PropertiesService" src/                  # doit ne citer que Keys.gs
grep -rn "accessToken" src/                        # Lwa.gs, AsinCheck.gs (context), Restrictions.gs (en-tête)
ls src | sed 's/\.[^.]*$//' | sort | uniq -d       # doit être vide (collision .gs / .html)
```

### Étape 1 — clés et connexion

1. `clasp push`, recharger le classeur → menu « ASIN Checker », huit entrées en trois groupes.
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
    `NOT_FOUND` (code `ASIN_NOT_FOUND`, Amazon répond 200) / `INVALID_ASIN` (code `FORMAT`,
    rejeté en local sans appel réseau — vérifiable dans les journaux d'exécution). Les quatre
    statuts sont définitifs : aucun n'est repris au run suivant.
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
20. **Arrêt sur un mauvais Seller ID** : garder de **vraies** clés fonctionnelles et mettre un
    Seller ID erroné en B4 de l'onglet « Paramètres » → le run s'arrête au **premier** ASIN,
    alerte « Requête refusée par Amazon (HTTP 400) » renvoyant vers le Seller ID et la
    marketplace, et **aucune** ligne ne reçoit de statut : la colonne B reste vide partout. Les
    journaux d'exécution montrent un seul appel SP-API, pas un par ASIN.
    C'est le test de non-régression du bug le plus coûteux rencontré : avant correctif, ce même
    Seller ID erroné marquait silencieusement toute la liste en `INVALID_ASIN`, un statut
    définitif que seul « Effacer les résultats » pouvait annuler.
    De fausses clés ne testent **pas** ce chemin : LWA refuse le jeton avant le premier ASIN et
    l'alerte est « Authentification Amazon ».
    Les chemins **401** et **403** ne sont pas provoquables proprement (il faudrait un jeton
    accordé par LWA puis refusé par SP-API, ou une application aux droits incomplets) : ils se
    vérifient par relecture du code — `isFatalHttpCode_` et les branches de `toOutcome_`
    (`Restrictions.gs`), tentative unique de `checkAsinWithRefresh_` (`AsinCheck.gs`), et
    l'allowlist `RUN_FATAL_MESSAGES`.
21. Journaux d'exécution et cellules : aucun fragment de clé ni de jeton.
22. **Non-régression `conditionType`** : `B0CHXMX9XC` doit donner `APPROVAL_REQUIRED`. Sa réponse
    contient une restriction en `new_new` avec des `links` dans `reasons[]` : si ce test ressort
    `ELIGIBLE`, c'est que la comparaison de `conditionType` est redevenue une égalité stricte au
    lieu d'un test de préfixe.

### Étape 3 — couleurs, Récap, panneau

23. « Appliquer les couleurs » deux fois de suite → les six couleurs sont posées et **aucune règle
    dupliquée** (Format → Mise en forme conditionnelle). Une règle ajoutée à la main survit.
24. « Créer / réparer le Récap » sur données mélangées puis sur un onglet « ASINs » vide → tout à
    0, 0,0 %, « Dernier passage » vide (et non « 30/12/1899 ») ; aucune `#ERROR!` sur un classeur
    en locale française ; la cellule sonde (E1) est vide après l'opération. Un second appel donne
    le même résultat.
25. **Chaîne complète** : coller plusieurs centaines d'ASINs, « Ouvrir le panneau » → « Lancer ».
    Les compteurs et la barre avancent **pendant** la tranche (écriture par paquets), les tranches
    s'enchaînent sans intervention, et le bilan final porte sur la chaîne entière, pas sur la
    dernière tranche. *Vérifié : 624 ASINs en 2 tranches.*
26. « Arrêter » en cours de tranche → le run s'arrête après l'ASIN courant, message « Arrêt
    demandé… N vérifié(s) au total », puis « Lancer / Reprendre » repart où ça s'était arrêté.
    *Vérifié en 2ᵉ tranche.*
27. Lancer « Vérifier les ASINs » depuis le menu pendant qu'une tranche tourne → alerte
    « Vérification déjà en cours » (verrou), et le « Arrêter » du panneau reste opérant.
28. Taper `ERROR` à la main dans une ligne déjà vérifiée, puis lancer le panneau → la ligne est
    reprise **une seule fois** dans la chaîne ; si elle ressort `ERROR`, la chaîne se termine au
    lieu de boucler.
29. Pour tester l'enchaînement sans attendre, baisser temporairement `MAX_RUN_MILLIS` (8000 par
    exemple) — **et le remettre à 270000 avant tout commit**.
