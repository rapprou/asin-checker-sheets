# asin-checker-sheets

Add-on Google Sheets (Apps Script, runtime **V8**, synchronisé par **clasp**) qui vérifie si des
ASINs sont vendables sur Amazon via SP-API `GET /listings/2021-08-01/restrictions`.
L'hôte dépend de la région du marché choisi : `sellingpartnerapi-eu.amazon.com` pour l'Europe,
`sellingpartnerapi-na.amazon.com` pour l'Amérique du Nord (voir « Marketplaces et régions »).

Le script est livré à des clients : **chacun utilise ses propres clés SP-API**, saisies dans sa
copie du classeur. Rien n'est mutualisé, aucun secret n'est versionné.

État actuel : **étapes 1 à 5 terminées** — clés et connexion (1), onglet « ASINs » et vérification
(2), couleurs, « Summary » et panneau (3), interface anglaise et reprise des classeurs français
(4), effacement des résultats périmés et pluriels (5) — et **étape 6 en attente de test réel** :
le code des marchés US, CA et MX est écrit et couvert par les tests automatiques, mais **aucun
appel SP-API n'a encore été fait sur l'hôte NA**. Validé en réel : **624 ASINs en 2 tranches**,
arrêt en cours de 2ᵉ tranche puis reprise sans trou ni doublon.

**Interface en anglais** depuis l'étape 4 : tous les textes affichés, les trois onglets et les
en-têtes. Les commentaires et cette documentation restent en français. La dernière version à
interface française est le tag git `fr-v1` ; le modèle français distribué reste sur cette version
et **ne doit pas recevoir ce code**. Les codes de statut (`ELIGIBLE`, `APPROVAL_REQUIRED`,
`NOT_ELIGIBLE`, `NOT_FOUND`, `INVALID_ASIN`, `ERROR`) et de restriction (`ASIN_NOT_FOUND`,
`FORMAT`) n'ont **pas** été traduits : ils pilotent la mise en forme conditionnelle et les tests.

## Structure

| Fichier | Responsabilité |
|---|---|
| `src/appsscript.json` | Manifeste : runtime V8, fuseau, scopes OAuth minimaux |
| `src/Menu.gs` | Menu « ASIN Checker » dans `onOpen` (et rien d'autre) : trois groupes d'entrées |
| `src/Config.gs` | Constantes partagées (`APP_NAME`, `CELLS`, `MARKETPLACES`, hôtes SP-API), onglet « Settings », résolution d'un marché par son libellé (`findMarketplaceByLabel_`) et du nom d'onglet français (`findSheetWithLegacyName_`), `showToast_()` |
| `src/Keys.gs` | Seul fichier qui touche aux clés (PropertiesService) : enregistrement, statuts, effacement |
| `src/KeysUi.gs` | Ouverture du dialogue `HtmlService` (nom distinct de `KeysDialog.html` : voir ci-dessous) |
| `src/KeysDialog.html` | Formulaire de saisie, champs masqués, CSS/JS inline |
| `src/Lwa.gs` | Échange `refresh_token` → jeton d'accès sur `api.amazon.com`, et cache du jeton |
| `src/Validation.gs` | `validateSettings_()` : la configuration est-elle complète ? (deux appelants) |
| `src/ConnectionTest.gs` | Test de connexion LWA, rendu OK/FAILED dans l'onglet « Settings » |
| `src/SelfTest.gs` | Entrée « Run self-test » : diagnostic en quatre étapes, un seul appel SP-API, rapport en alerte (n'écrit rien) |
| `src/Asins.gs` | Onglet « ASINs » : mise en page, sélection des lignes à traiter, écriture des résultats, comptes par statut |
| `src/EditTrigger.gs` | Déclencheur simple `onEdit` : une édition de la colonne A d'« ASINs » efface B:D sur les lignes touchées (`staleResultsClearRange_`) |
| `src/Statuses.gs` | **Source unique** de l'affichage des statuts : ordre et couleurs (`statusStyles_`, `statusList_`, `statusStyle_`) |
| `src/Formatting.gs` | Mise en forme conditionnelle par statut sur `ASINs!A2:D`, idempotente |
| `src/Summary.gs` | Onglet « Summary » : formules seules, détection du séparateur d'arguments |
| `src/Restrictions.gs` | Appel SP-API `restrictions` + classification du statut |
| `src/RunControl.gs` | Chaîne de runs : drapeau d'arrêt (cache) et `chainStart` (`resolveChainStart_`) |
| `src/AsinCheck.gs` | Cœur d'un run : cadence, budget temps, écriture par paquets, compte-rendu |
| `src/Sidebar.gs` | Points d'entrée du panneau (`showSidebar`, `runFromSidebar`, `getCounters`, `stopRun`) |
| `src/SidebarPanel.html` | Panneau : compteurs, barre de progression, boutons, journal, enchaînement des tranches |
| `tests/classify.js` | Tests des fonctions pures, exécutés par `node` (hors Apps Script) |

`Config.gs` et `Statuses.gs` ne dépendent d'aucun autre fichier (hors `ASIN_STATUS`, lu dans une
fonction). `EditTrigger` ne dépend que d'`Asins` (constantes et `normalizeAsin_`).
Les dépendances vont dans un seul sens : `Menu` → `KeysUi`/`ConnectionTest`/`SelfTest`/`Sidebar`/
`AsinCheck`/`Formatting`/`Summary` → `Validation`/`Asins`/`Restrictions`/`RunControl` →
`Keys`/`Lwa` → `Config`/`Statuses`.

**Une seule exception, assumée** : `SelfTest` dépend d'`AsinCheck` (`buildContext_`, `runFatal_`,
`regionHint_`, `RUN_FATAL_MESSAGES`), c'est-à-dire d'un fichier de sa propre rangée. C'est le prix
de la réutilisation : dupliquer la construction du contexte ou les messages d'arrêt serait pire, et
descendre ces fonctions dans une rangée inférieure remanierait `AsinCheck.gs` sans autre bénéfice.

**Nommage des fichiers** : Apps Script identifie les fichiers par leur nom *sans extension*.
Deux fichiers ne peuvent donc pas s'appeler `Foo.gs` et `Foo.html` — `clasp push` échoue avec
« A file with this name already exists ». D'où `KeysUi.gs` à côté de `KeysDialog.html`, et
`Sidebar.gs` à côté de `SidebarPanel.html`.

## Noms d'onglets : `Settings`, `ASINs`, `Summary`

Les trois onglets portent des noms anglais. `ASINs` n'a jamais changé ; `Settings` et `Summary`
s'appelaient `Paramètres` et `Récap` dans la version française (tag git `fr-v1`).

Ce qui dépend de ces noms, exhaustivement :

| Dépendance | Détail |
|---|---|
| `getSettingsSheet_()` (`Config.gs`), `getSummarySheet_()` (`Summary.gs`) | `getSheetByName`, via `findSheetWithLegacyName_` |
| `findAsinsSheet_()` / `ensureAsinsSheet_()` (`Asins.gs`) | `getSheetByName(ASIN_SHEET_NAME)` — nom inchangé |
| Formules du « Summary » | `asinRange_()` construit `'ASINs'!A2:A` depuis `ASIN_SHEET_NAME` — **seul** `ASINs` y figure |
| ~10 messages affichés | citent un onglet en clair (`Validation.gs`, `AsinCheck.gs`, `ConnectionTest.gs`, `Keys.gs`, `Asins.gs`, `Formatting.gs`, `Summary.gs`, `SidebarPanel.html`) |

Et ce qui n'en dépend **pas**, contrairement à l'intuition : les règles de mise en forme
conditionnelle. Leur formule est `=$B2="ELIGIBLE"` (`statusFormatFormula_`), sans nom d'onglet —
elles sont attachées à un `Range`, pas à un nom. Renommer un onglet ne les touche jamais.
`SIDEBAR_TEMPLATE_NAME` et `DIALOG_TEMPLATE_NAME` ne sont pas des noms d'onglets mais des noms
de *fichiers*.

**Reprise des classeurs français** : `findSheetWithLegacyName_(spreadsheet, name, legacyName)`
(`Config.gs`) cherche le nom anglais, puis le nom français, et dans ce second cas **renomme
l'onglet en place** avant de le rendre. Le renommage, et non une création, est ce qui compte :
le nom du vendeur, le Seller ID et la marketplace vivent dans la feuille (B3, B4, B5) et non dans
les propriétés du script. Sans cette résolution, un onglet `Settings` vide serait inséré à côté et
ces trois valeurs resteraient sur un onglet orphelin — l'utilisateur ne lisant qu'un
« Seller ID is empty ». Renommer en place a un second effet utile : Sheets réécrit de lui-même les
formules que le client aurait pu écrire vers `Paramètres!…`.

Si les deux onglets existent, **l'anglais gagne et le français est laissé intact** : `setName()`
lève sur une collision de noms, et le script ne supprime jamais un onglet de l'utilisateur.
La fonction reçoit le classeur en paramètre et n'appelle pas `SpreadsheetApp`, donc elle est
testée hors Apps Script avec un faux classeur.

## Scopes OAuth (`src/appsscript.json`)

- `spreadsheets.currentonly` — lire/écrire **uniquement le classeur conteneur**. Choisi à la
  place de `.../auth/spreadsheets`, qui donnerait accès à tous les Sheets du client.
- `script.container.ui` — menu, dialogue modal, toasts.
- `script.external_request` — `UrlFetchApp` vers `api.amazon.com` (jeton LWA, toutes régions) et
  l'hôte SP-API du marché choisi : `sellingpartnerapi-eu.amazon.com` ou
  `sellingpartnerapi-na.amazon.com`.

Le manifeste ne déclare **aucun** `urlFetchWhitelist` : `script.external_request` n'épingle pas
d'hôte, donc l'ajout de l'hôte NA n'a demandé ni modification du manifeste ni nouvelle
autorisation de la part des clients.

`PropertiesService` et `CacheService` ne demandent aucun scope. N'ajouter un scope que si une API le refuse
explicitement — et le justifier ici.

## Marketplaces et régions

`MARKETPLACES` (`Config.gs`) est la **source unique** : chaque entrée porte `code`,
`marketplaceId`, `region` (`EU` / `NA`) et `host`. Neuf marchés, dans cet ordre — FR, DE, ES, IT,
UK, NL, puis US, CA, MX. Les deux hôtes (`SPAPI_HOST_EU`, `SPAPI_HOST_NA`) sont déclarés **dans
`Config.gs`** et non dans `Restrictions.gs` : l'hôte est une propriété du marché, et le sens des
dépendances va de `Restrictions` vers `Config`, jamais l'inverse — c'est aussi ce qui garde le
jeton d'accès hors de `Config.gs`.

L'hôte n'est plus une constante globale du script : il voyage dans le `context` du run
(`buildContext_`, `AsinCheck.gs`) et `restrictionsUrl_` (`Restrictions.gs`) le lit là.
**Ne jamais lui donner de valeur de repli dans `Restrictions.gs`** : l'URL est construite *dans*
le `try` de `fetchRestrictions_`, donc un hôte manquant ne lèverait pas — il ressortirait en
`ERROR / NETWORK` sur **chaque ligne**, indistinguable d'une panne réseau. C'est le pire mode
d'échec de cette partie, et c'est pourquoi deux assertions tiennent le chemin de l'hôte :
`restrictionsUrl_` par marché, et la liste des champs de `buildContext_`.

**Le format du libellé est gelé.** `marketplaceLabel_` rend `'US — ATVPDKIKX0DER'` (tiret
cadratin entouré d'espaces), et `findMarketplaceByLabel_` le compare par **égalité stricte**.
Ce libellé est la valeur écrite en B5 dans les classeurs déjà distribués : en changer le format
les rendrait tous illisibles, et la liste déroulante stricte (`setAllowInvalid(false)`)
empêcherait même de les ressaisir. Trois assertions figent cela, dont un tiret simple et une
casse différente qui doivent rendre `null`.

**Liste déroulante B5 : elle ne se régénère pas toute seule.**
`applyMarketplaceValidation_` n'est appelée que par `buildSettingsLayout_` ←
`ensureSettingsSheet_`, dont les trois seuls appelants sont « Enter / edit keys », « Test
connection » et « Clear keys ». Ni `onOpen` (qui n'écrit rien, par conception) ni « Check ASINs »
ne la touchent. Conséquences :

- Un classeur client déjà copié garde une liste à 6 entrées après un `clasp push`, et comme la
  validation est stricte l'utilisateur ne peut pas non plus **taper** un libellé NA à la main.
  En pratique il traverse « Enter / edit keys » de toute façon, puisqu'un marché NA demande un
  `refresh_token` de la région NA.
- **Après un push vers le Template, lancer « Clear keys » dans le Template** pour régénérer la
  liste à 9 entrées. Plus léger et sans effet de bord : il suffit d'**ouvrir** « Enter / edit
  keys » puis de fermer le dialogue — `ensureSettingsSheet_` est déjà passé, et rien n'est
  modifié (un champ vide = clé inchangée).
- Un marché EU déjà choisi survit à l'extension de la liste : son libellé y figure encore.

**« Test connection » ne teste ni la région ni le marché.** Il n'interroge que LWA sur
`api.amazon.com` et ignore l'hôte SP-API comme le `marketplaceId`. Un vendeur EU qui choisit US
lira donc « OK » en B13, puis verra le run s'arrêter au premier ASIN. Ne pas « corriger » cela en
y ajoutant un appel SP-API sans le décider explicitement : tester la connexion doit rester un
geste gratuit en quota.

**Les résultats valent pour le marché de B5**, et rien ne le trace dans la feuille (colonnes A:D
seulement). Changer de marché puis relancer mélangerait silencieusement deux marchés sur la même
liste — c'est déjà vrai entre les six marchés EU. La parade est documentaire : après un changement
de marché, lancer « Clear results ». Ajouter une colonne de marché coûterait `ASIN_RESULT_WIDTH`,
`staleResultsClearRange_`, `clearAsinResults`, le « Summary » et `freshResults_` : hors périmètre
tant que personne ne l'a demandé.

**Mismatch région ↔ clés : indétectable, donc seulement signalé.** Rien ne stocke la région des
clés, et le corps de réponse n'est jamais lu (règle secrets 8). `regionHint_` (`AsinCheck.gs`)
ajoute donc aux arrêts **400 et 403** une phrase qui nomme le marché choisi — « Selected
marketplace: US (North America endpoint)… » — construite depuis la table locale, jamais depuis une
réponse Amazon. Le 401 en est exclu (il porte sur le jeton, et la tentative avec jeton frais a
déjà eu lieu), et la piste disparaît en silence dès qu'une information manque.

**Constaté en réel le 17/11/2026** (Sheet TEST) : un marché **US avec des clés et un Seller ID
EU** fait répondre Amazon en **HTTP 403**, et le run s'arrête avant d'avoir écrit le moindre
statut venant de l'API. `RUN_REGION_HINT_CODES = [400, 403]` est donc confirmé pour le 403, et la
piste région s'affiche bien dans l'alerte. Le **401 n'a pas été observé** sur ce chemin : il n'est
pas ajouté à la liste, et il ne doit l'être que sur un constat, pas par précaution — il porte sur
le jeton, et la tentative avec jeton frais a déjà eu lieu avant lui.

Le **sens inverse n'a pas été testé** : des clés NA sur un marché EU, faute de compte NA actif.
Rien n'indique qu'il se comporterait autrement, mais ce n'est à ce jour qu'un raisonnement.

Le jeton LWA s'obtient sur `api.amazon.com` quelle que soit la région : la région n'entre dans
aucun paramètre de l'échange. La clé de cache du jeton n'est donc **pas** régionalisée, et ne doit
pas l'être — ce serait doubler les échanges LWA sans bénéfice. (Qu'Amazon accepte bien ce jeton sur
l'hôte NA reste à constater en réel.) Enfin, `clearCachedToken_` purge le jeton sur **tous** les
codes fatals, 400 et 403 compris : sur une erreur de région il était pourtant valide, et cela
coûte un échange LWA au run suivant. Comportement assumé, pas une régression.

## Run self-test

Entrée de menu du premier groupe, juste après « Test connection ». Quatre étapes dans cet ordre,
**arrêt au premier échec**, rapport en **alerte** — le self-test n'écrit rien :

| # | Vérification | Réutilise | Réseau |
|---|---|---|---|
| 1 | Les trois clés sont présentes | `missingKeyLabels_` — libellés d'absence, jamais une valeur | aucun |
| 2 | Un jeton LWA est disponible | `getAccessToken_`, échec via `lwaErrorMessage_` (allowlist) | LWA, sauf jeton en cache |
| 3 | Seller ID non vide, puis marché de B5 valide | `readSellerId_`, `readMarketplace_` | aucun |
| 4 | Une sonde `restrictions` aboutit | `buildContext_` puis `fetchRestrictions_` | **un seul appel** |

**Le Seller ID est à l'étape 3 et non à l'étape 1** : l'ordre voulu est clés → LWA → feuille, et
un Seller ID vide ferait échouer la sonde en 400 sans rien expliquer. `validateSettings_()` n'est
pas réutilisable ici — elle contrôle les trois choses d'un coup et signalerait la marketplace
avant LWA.

**Verdict de la sonde** (`selfTestProbeVerdict_`) : l'étape ne teste que l'accès, donc **tout
statut rendu par Amazon est un succès**.

| Réponse | Verdict |
|---|---|
| 200, 404 | `PASS` — l'hôte a répondu sur l'ASIN |
| 429 | `BUSY` — état de quota, pas un défaut de configuration. `fetchRestrictions_` ne fait aucun backoff, donc un self-test ne dort jamais |
| 400, 403 | `FAIL` + la piste région de `regionHint_` |
| 401 | `FAIL`, message dédié (voir ci-dessous) |
| 0, autre | `FAIL`, code HTTP seul |

Le verdict ne recopie pas la liste des codes fatals : une assertion croise `isFatalHttpCode_`
(`Restrictions.gs`) avec le verdict, pour que les deux ne puissent pas diverger.

**Le 401 n'est pas rendu comme « clés refusées »**, et c'est la subtilité du fichier. Le jeton
peut venir du cache (50 min) :

- `saveKeys` ne purge le cache **que si au moins un champ a été soumis non vide** ; ouvrir le
  dialogue et le fermer ne purge rien.
- `clearKeys` purge, mais **seulement après un OUI**.
- **« Test connection » ne purge ni n'alimente le cache** : `requestAccessToken_` n'y touche pas.

Un 401 sur la sonde peut donc venir d'un jeton en cache périmé et non des clés. Le self-test **ne
relance pas** avec un jeton frais : `checkAsinWithRefresh_` y parvient en appelant
`clearCachedToken_()` (`AsinCheck.gs`), ce qui casserait un run en cours, et l'éviter imposerait
`requestAccessToken_(getCredentials_())`, soit un troisième appelant de `getCredentials_` contre
la règle secrets 3. Le message dit donc l'état réel : lancer « Test connection » pour
diagnostiquer les **clés** (il ignore le cache), et pour écarter le **jeton** ressaisir une clé via
« Enter / edit keys » ou attendre l'expiration. Conseiller « Test connection puis relancer le
self-test » serait faux : le cache survivrait et le 401 reviendrait à l'identique.

**L'étape 2 ne prouve pas que LWA a répondu à l'instant** — un jeton en cache la rend verte sans
aucun appel. Le rapport le dit (« may come from the 50-minute cache »), et c'est la raison de
garder les deux entrées de menu : « Test connection » est le seul chemin sans cache.

**Sonde `SELF_TEST_ASIN = 'B0ZZZZZZZZ'`** (`Config.gs`), ASIN inexistant : en Europe Amazon répond
200 avec `ASIN_NOT_FOUND`, un succès indépendant du catalogue et du compte. Son format est valide,
sinon `isValidAsinFormat_` la rejetterait en local et l'étape 4 ne testerait plus rien (une
assertion le vérifie).

> ⚠️ **Validé en EU seulement.** Le comportement d'Amazon sur un ASIN inexistant **n'a jamais été
> constaté sur US, CA ni MX**. Le verdict y resterait un succès pour tout statut rendu, donc la
> sonde ne devrait pas en souffrir — mais ce n'est qu'un raisonnement, à confirmer dès qu'un
> compte NA est disponible (point 61).

**Quatre interdits**, qui tiennent le reste :

1. **Aucun verrou.** Le self-test ne lit ni n'écrit aucune ligne, et prendre le verrou le rendrait
   inutilisable pendant un run — précisément quand on diagnostique.
2. **Jamais `clearCachedToken_()`.** Un self-test cliqué pendant une tranche purgerait le jeton de
   ce run. Rien de `RunControl.gs` non plus : ni drapeau d'arrêt, ni `chainStart`.
3. **Aucune écriture hors de `ensureSettingsSheet_()`**, appelé comme par les trois autres entrées
   du groupe. Rien dans « ASINs » ni « Summary », et **B13:B15 n'est jamais touché** : un
   self-test en échec ne doit pas effacer un « OK » de « Test connection ».
4. **`ConnectionTest.gs` n'est pas modifié** — ni son texte, ni son chemin sans cache.

Le rapport n'a que trois sources possibles : libellés de clés absentes, allowlist LWA, code HTTP.
Une étape du rapport ne porte que deux champs (`verdict`, `detail`), et une assertion le fige :
c'est ce qui empêche le jeton d'y entrer. Le mot « token » y figure, lui, légitimement — c'est le
libellé de l'étape 2.

## Onglet « ASINs »

```
     A        B        C                  D
1    ASIN     Status   Restriction code   Checked on     (en-têtes, ligne figée)
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
jamais réinterrogés — seul « Clear results » les remet en jeu. Conséquence à garder en tête si
un nouveau statut est ajouté : tout statut non listé dans `isPendingStatus_` est définitif.

Les couleurs de la colonne B viennent de règles de **mise en forme conditionnelle** posées sur
`A2:D` (`Formatting.gs`), jamais d'un `setBackground` par cellule : une ligne se recolore dès que
son statut change, et « Clear results » la rend blanche sans travail. Nos règles sont
reconnues à leur formule (`=$B<ligne>="<STATUT>"`, n'importe quel numéro de ligne) puis réécrites,
donc une relance ne duplique rien et ne touche pas aux règles posées à la main par le client.

La colonne A n'est **jamais** réécrite : `normalizeAsin_()` (trim + majuscules) ne sert qu'à
construire la requête.

**Résultat périmé — édition de la colonne A** (`EditTrigger.gs`) : sans garde-fou, remplacer
l'ASIN d'une ligne vérifiée laissait l'ancien statut — définitif, donc jamais réinterrogé — à
côté du nouvel ASIN. Le déclencheur simple `onEdit` efface B:D sur toute ligne (≥ 2) de la
colonne A éditée par l'utilisateur dans « ASINs » : saisie, collage multi-lignes ou A:D,
suppression. Exception : une édition mono-cellule dont `e.oldValue` égale `e.value` à la
normalisation près (retaper « b07x » sur « B07X ») n'efface rien, le résultat reste valable ;
dès que `oldValue` manque (collage), on efface par prudence. La logique de décision est la
fonction pure `staleResultsClearRange_`, testée hors Apps Script.

Ce que `onEdit` ne voit **pas**, et c'est vérifié/assumé : les écritures du script
(`setValues`, `clearContent`) et les appels API ne le déclenchent jamais — un run n'efface pas
ses propres résultats ; le **tri** (Données > Trier la plage, ou tri par filtre) part en
`onChange` (`changeType: OTHER`), donc trier ne perd aucun résultat ; l'insertion/suppression
de lignes entières relève aussi d'`onChange`, hors périmètre. **Annulation (Cmd+Z)**, constaté
en réel : l'effacement du script entre dans la pile d'annulation comme une étape à part — un
premier Cmd+Z restaure l'ASIN d'origine (B:D encore vides), un second restaure aussi l'ancien
résultat, en face du bon ASIN. À aucun moment la ligne ne montre le nouvel ASIN avec l'ancien
statut, et s'arrêter au premier Cmd+Z coûte au pire une revérification au run suivant.

**Note pour le futur guide utilisateur** : pour trier, Données > Créer un filtre sur `A:D` ;
**ne jamais trier la colonne A seule** — B:D ne suivraient pas et chaque statut se
retrouverait en face du mauvais ASIN, sans que `onEdit` puisse le voir (le tri passe par
`onChange`).

`onEdit` ne prend pas le verrou (un déclencheur simple doit rendre la main vite, et
l'effacement est la volonté de l'utilisateur quel que soit l'état du run). La course avec un
run en cours est fermée côté run : au flush, `freshResults_` (`AsinCheck.gs`, fonction pure)
relit la colonne A des lignes du paquet et **écarte tout résultat dont l'ASIN ne correspond
plus** — la ligne garde sa colonne B vide et repart au run suivant avec le bon ASIN.
`result.asin` sort de `selectPendingRows_` déjà normalisé, la feuille est normalisée au moment
de comparer (un test le prouve). Bénéfice collatéral : une insertion de ligne en plein run,
qui décale les numéros mémorisés, ne peut plus poser un statut en face du mauvais ASIN. Les
résultats écartés restent consommés par le compteur `written` (sinon le `finally` les
représenterait) et comptés dans « checked » — la requête a bien été faite.

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
  d'une chaîne (**sous le verrou**, pour qu'un panneau refusé n'annule pas un « Stop » en cours)
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

## Onglet « Summary »

Créé et **réparé** par « Create / repair Summary » (`ensureSummarySheet`) : le bloc `A:C` est
effacé puis réécrit, donc une ligne laissée par une version antérieure disparaît. Tout l'onglet
appartient au script, rien d'y saisir n'est conservé.

Il ne contient **que des formules** — aucun compte calculé par le script : les chiffres suivent
l'onglet « ASINs » en direct, et un « Summary » jamais régénéré reste juste. Les lignes de statuts sont
générées depuis `statusList_()`, les couleurs viennent de `statusStyle_()`.

Le **séparateur d'arguments suit la locale** du classeur : un Sheet français attend `;` et renvoie
`#ERROR!` sur une formule à virgules — `setFormula()` ne traduit rien (bug constaté en test réel).
Il n'existe aucune API pour le lire, donc `detectFormulaSeparator_()` le constate : une sonde
`=SUM(1<sép>1)` est écrite hors du tableau, `flush()`, et la valeur relue doit valoir 2. La cellule
sonde est vidée dans un `finally`, la détection a lieu **avant** l'effacement du bloc, et si aucun
séparateur ne passe elle lève — plutôt que de remplir le « Summary » de `#ERROR!`. Les constructeurs de
formules (`summaryPlan_` et ses aides) restent purs et reçoivent le séparateur en paramètre.

## Règles secrets (non négociables)

1. Les clés (`client_id`, `client_secret`, `refresh_token`) vivent **uniquement** dans les
   propriétés du script (`PropertiesService.getScriptProperties()`).
2. Jamais de valeur ni de fragment de valeur dans une cellule, un `Logger.log`, un `toast`,
   un message d'erreur, un commit ou le retour d'une fonction appelée depuis le HTML.
   L'onglet « Settings » n'affiche que « saved » / « missing ».
3. Une seule fonction lit les valeurs : `getCredentials_()` dans `src/Keys.gs`. Elle est privée
   et sert uniquement à `requestAccessToken_()`. Ne pas l'appeler ailleurs.
4. L'effacement (`deleteStoredKeys_()`) supprime les trois propriétés une par une via
   `deleteProperty`. **Ne pas utiliser `deleteAllProperties()`** : les autres propriétés du
   script, actuelles ou futures, ne doivent pas être emportées. L'effacement ne touche ni le
   nom du vendeur, ni le Seller ID, ni la marketplace (qui vivent dans la feuille, pas dans
   les propriétés). En revanche il remet à blanc le bloc « Connection test »
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
  **Une fonction globale est une cible de menu, de `google.script.run` ou un déclencheur
  simple, point.** Soit, à ce jour : `onOpen` et `onEdit` (déclencheurs simples),
  `showKeysDialog`, `testConnection`, `runSelfTest`, `clearKeys`, `checkAsins`,
  `clearAsinResults`, `showSidebar`, `applyStatusFormatting`, `ensureSummarySheet` (menu),
  `saveKeys`, `getKeyStatuses` (dialogue) et `runFromSidebar`, `getCounters`, `stopRun`
  (panneau). Ne pas en ajouter d'autres.
- Les statuts et leurs couleurs ne se citent qu'à travers `Statuses.gs` : ajouter un statut à
  `ASIN_STATUS` sans lui donner de couleur fait tomber les tests.
- Deux fichiers `.gs` partagent le même espace de noms global : vérifier qu'une nouvelle
  constante `UPPER_SNAKE_CASE` n'existe pas déjà ailleurs (`grep -rn "^var NOM" src/`).
- **Textes affichés en anglais, commentaires en français** (identifiants en anglais aussi).
  L'interface est destinée à un public anglophone ; les commentaires et cette documentation
  restent en français, langue de travail du projet. Un test le vérifie : aucune lettre
  accentuée ne doit apparaître hors d'une ligne de commentaire (voir « garde non-ASCII »
  plus bas). Seules exceptions admises, les deux noms d'onglets de la version française.
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
node tests/classify.js     # 337 assertions, sortie non nulle en cas d'échec
```

Couvre **toutes les fonctions pures** du projet : classification (`classifyRestrictions_`,
`toOutcome_`, `isPendingStatus_`), couleurs et reconnaissance des règles (`statusStyles_`,
`isStatusFormatFormula_`), formules du « Summary » (`summaryPlan_`, vérifiées avec `,` **et** `;`),
sélection des lignes d'une chaîne (`selectPendingRows_`), `resolveChainStart_`, compteurs
(`countStatuses_`), découpage des écritures (`unwrittenResults_`, `shouldFlush_`, `runEnd_`),
résolution du nom d'onglet français (`findSheetWithLegacyName_`, avec un faux classeur),
effacement des résultats périmés (`staleResultsClearRange_`), garde au flush (`freshResults_`,
dont la preuve que `selectPendingRows_` rend l'ASIN déjà normalisé) et pluriels des bilans
(`countLabel_`, `runSummary_` vérifié mot pour mot).

S'y ajoutent, depuis l'ajout de l'Amérique du Nord : la table `MARKETPLACES` (neuf marchés, ordre
et IDs EU inchangés, hôte croisé avec les constantes et non avec des littéraux recopiés), le
format gelé du libellé et sa résolution (`marketplaceLabel_`, `findMarketplaceByLabel_`), l'hôte
de l'URL (`restrictionsUrl_` par marché), la liste exacte des champs du contexte
(`buildContext_`, qui doit porter `host` et rien qui vienne d'Amazon), et le message d'arrêt
(`runFatal_`, `fatalMessage_`, `noMarketplaceMessage_`) avec ses trois replis — région inconnue,
marché absent, code hors allowlist.

Et depuis « Run self-test » : le verdict de la sonde (`selfTestProbeVerdict_`, croisé avec
`isFatalHttpCode_`), son détail (`selfTestProbeDetail_`, dont le 401 traité avant l'allowlist), le
marché nommé (`selfTestMarketplaceDetail_`) et le rapport (`selfTestReport_`, `selfTestSummary_` :
étapes `SKIPPED`, `BUSY` distinct d'un échec, forme à deux champs d'une étape). `runSelfTest` et
`selfTestSteps_` ne sont pas testables ici — ils touchent la feuille et le réseau.

S'y ajoute le **garde non-ASCII** : aucune lettre latine accentuée ne doit apparaître dans
`src/*.gs` ni `src/*.html` hors d'une ligne de commentaire. C'est le filet contre une traduction
laissée à moitié — un libellé oublié est signalé avec son fichier et sa ligne. Le test porte sur
les *lettres* accentuées et non sur tout non-ASCII : `—`, `…` et `→` sont de la ponctuation
anglaise légitime, utilisée par les libellés affichés. Les deux seules exceptions admises sont
les lignes `LEGACY_SETTINGS_SHEET_NAME` et `LEGACY_SUMMARY_SHEET_NAME`, qui doivent forcément
citer « Paramètres » et « Récap ». Conséquence pratique : un commentaire français ne peut pas
être écrit **en fin de ligne de code** — il doit occuper sa propre ligne, sinon le garde le
signale.

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
| un libellé français laissé dans le code | 1 (avec son fichier:ligne) |
| nom d'onglet français non résolu | 2 |
| garde au flush supprimée (`freshResults_` rend tout) | 2 |
| `onEdit` effaçant hors onglet « ASINs » ou hors colonne A | 3 |
| comparaison valeur inchangée non normalisée | 1 |
| ligne d'en-têtes non protégée de l'effacement | 2 |
| pluriel « 1 ASINs » réintroduit | 4 |
| hôte SP-API remis en dur dans `restrictionsUrl_` | 1 (« marché NA → hôte NA ») |
| `host` retiré du contexte (`buildContext_`) | 3 |
| format du libellé de marketplace modifié | 3 à 12 selon le changement |
| 401 de la sonde renvoyé vers l'allowlist au lieu du message « jeton en cache » | 1 |
| sonde au format d'ASIN invalide | 1 |
| `BUSY` de la sonde rendu comme un échec | 2 |

Ce qui n'est **pas** testable ainsi — `SpreadsheetApp`, `UrlFetchApp`, `PropertiesService`,
`CacheService`, `LockService`, `HtmlService` — reste couvert par la checklist manuelle ci-dessous.

`tests/` n'est jamais poussé vers le projet Apps Script : `rootDir` vaut `src` dans
`.clasp.json`, ce que `clasp status` permet de confirmer.

## Vérification manuelle (rien ne s'exécute en local)

Contrôles statiques avant tout push :

```bash
node tests/classify.js                             # doit afficher 337/337
for f in src/*.gs; do cp "$f" "/tmp/$(basename "$f" .gs).js"; node --check "/tmp/$(basename "$f" .gs).js"; done
grep -rn "Logger\|console\." src/                 # doit être vide
grep -rn "PropertiesService" src/                  # doit ne citer que Keys.gs
grep -rn "accessToken" src/                        # Lwa.gs, AsinCheck.gs (context), Restrictions.gs (en-tête)
ls src | sed 's/\.[^.]*$//' | sort | uniq -d       # doit être vide (collision .gs / .html)
```

### Étape 1 — clés et connexion

1. `clasp push`, recharger le classeur → menu « ASIN Checker », neuf entrées en trois groupes.
2. « Enter / edit keys » → trois champs masqués et vides ; enregistrer une seule clé →
   cette ligne passe à « saved » dans l'onglet, les autres restent « missing ».
3. « Test connection » sans Seller ID → FAILED « Configuration incomplete », sans appel réseau.
4. Clés erronées → FAILED avec le message `invalid_client` ou `invalid_grant` correspondant.
5. Vraies clés → OK + horodatage.
6. « Clear keys » → la confirmation OUI/NON décrit ce qui va être supprimé, sans afficher
   de valeur. Répondre **Non** (ou fermer) → toast « Canceled: keys are unchanged. », les trois
   statuts restent « saved » et le résultat du dernier test est conservé. Répondre **Oui** → les
   trois statuts passent à « missing », les cellules B13:B15 (résultat, détail, date) sont
   vides, tandis que le nom du vendeur (B3), le Seller ID (B4) et la marketplace (B5) sont
   intacts.
7. Après effacement, « Test connection » → FAILED « Configuration incomplete: missing keys:
   client_id, client_secret, refresh_token … », sans appel réseau.
8. Vérifier dans l'éditeur (Paramètres du projet → Propriétés du script) que les trois clés ont
   bien disparu et qu'aucune autre propriété n'a été supprimée.
9. Relire les cellules d'état et les journaux d'exécution : aucun fragment de clé.

### Étape 2 — vérification des ASINs

10. « Check ASINs » sans clés → alerte « Configuration incomplete », aucun appel réseau,
    et l'onglet « ASINs » est créé avec ses quatre en-têtes et la ligne 1 figée.
11. Avec une configuration valide, quatre ASINs : un vendable, un soumis à approbation, un
    inexistant (`B0ZZZZZZZZ`) et un mal formé (`XXX`) → `ELIGIBLE` / `APPROVAL_REQUIRED` /
    `NOT_FOUND` (code `ASIN_NOT_FOUND`, Amazon répond 200) / `INVALID_ASIN` (code `FORMAT`,
    rejeté en local sans appel réseau — vérifiable dans les journaux d'exécution). Les quatre
    statuts sont définitifs : aucun n'est repris au run suivant.
12. Relancer « Check ASINs » → toast « No ASIN to check » : les lignes portant un
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
17. « Clear results » → **Non** ne change rien ; **Oui** vide B:D, tandis que la colonne
    A et la ligne d'en-têtes restent intactes.
18. Après « Clear keys », relancer « Check ASINs » → alerte « Configuration
    incomplète » et **aucun** appel SP-API : le jeton en cache a bien été purgé.
19. **Reprise d'un `ERROR`** : taper `ERROR` à la main dans une cellule B déjà remplie, puis
    relancer → cette seule ligne est réinterrogée, son statut est remplacé, le toast annonce
    « … retried after ERROR », et les lignes portant un statut définitif restent intactes.
    C'est la façon fiable de tester la reprise : un vrai `ERROR` dépend d'une panne réseau ou
    d'un 5xx, qu'on ne provoque pas à la demande.
20. **Arrêt sur un mauvais Seller ID** : garder de **vraies** clés fonctionnelles et mettre un
    Seller ID erroné en B4 de l'onglet « Settings » → le run s'arrête au **premier** ASIN,
    alerte « Request refused by Amazon (HTTP 400) » renvoyant vers le Seller ID et la
    marketplace, et **aucune** ligne ne reçoit de statut : la colonne B reste vide partout. Les
    journaux d'exécution montrent un seul appel SP-API, pas un par ASIN.
    C'est le test de non-régression du bug le plus coûteux rencontré : avant correctif, ce même
    Seller ID erroné marquait silencieusement toute la liste en `INVALID_ASIN`, un statut
    définitif que seul « Clear results » pouvait annuler.
    De fausses clés ne testent **pas** ce chemin : LWA refuse le jeton avant le premier ASIN et
    l'alerte est « Amazon authentication ».
    Les chemins **401** et **403** ne sont pas provoquables proprement (il faudrait un jeton
    accordé par LWA puis refusé par SP-API, ou une application aux droits incomplets) : ils se
    vérifient par relecture du code — `isFatalHttpCode_` et les branches de `toOutcome_`
    (`Restrictions.gs`), tentative unique de `checkAsinWithRefresh_` (`AsinCheck.gs`), et
    l'allowlist `RUN_FATAL_MESSAGES`.
21. Journaux d'exécution et cellules : aucun fragment de clé ni de jeton.
22. **Non-régression `conditionType`** : elle **ne se vérifie pas par un run réel**. Le statut en
    ligne d'un ASIN dépend du catalogue et du compte Amazon interrogés, et il change dans le
    temps — `B0CHXMX9XC`, capturé en `APPROVAL_REQUIRED` le 10/11/2026, ressortait `ELIGIBLE` le
    17/11/2026 sur le Sheet TEST. N'en attendre aucun statut particulier ici.
    Ce qui tient cette barrière est la **fixture figée** `tests/fixtures/B0CHXMX9XC.json` et ses
    assertions dans `tests/classify.js` : la réponse y contient une restriction en `new_new` avec
    des `links` dans `reasons[]`, et si le test ressort `ELIGIBLE`, c'est que la comparaison de
    `conditionType` est redevenue une égalité stricte au lieu d'un test de préfixe.

### Étape 3 — couleurs, Summary, panneau

23. « Apply colors » deux fois de suite → les six couleurs sont posées et **aucune règle
    dupliquée** (Format → Mise en forme conditionnelle). Une règle ajoutée à la main survit.
24. « Create / repair Summary » sur données mélangées puis sur un onglet « ASINs » vide → tout à
    0, 0,0 %, « Last run » vide (et non « 30/12/1899 ») ; aucune `#ERROR!` sur un classeur
    en locale française ; la cellule sonde (E1) est vide après l'opération. Un second appel donne
    le même résultat.
25. **Chaîne complète** : coller plusieurs centaines d'ASINs, « Open panel » → « Start / Resume ».
    Les compteurs et la barre avancent **pendant** la tranche (écriture par paquets), les tranches
    s'enchaînent sans intervention, et le bilan final porte sur la chaîne entière, pas sur la
    dernière tranche. *Vérifié : 624 ASINs en 2 tranches.*
26. « Stop » en cours de tranche → le run s'arrête après l'ASIN courant, message « Stop
    requested. N ASINs checked in total. », puis « Start / Resume » repart où ça s'était arrêté.
    *Vérifié en 2ᵉ tranche.*
27. Lancer « Check ASINs » depuis le menu pendant qu'une tranche tourne → alerte
    « Check already running » (verrou), et le « Stop » du panneau reste opérant.
28. Taper `ERROR` à la main dans une ligne déjà vérifiée, puis lancer le panneau → la ligne est
    reprise **une seule fois** dans la chaîne ; si elle ressort `ERROR`, la chaîne se termine au
    lieu de boucler.
29. Pour tester l'enchaînement sans attendre, baisser temporairement `MAX_RUN_MILLIS` (8000 par
    exemple) — **et le remettre à 270000 avant tout commit**.

### Étape 4 — interface anglaise et reprise des classeurs français

Les quatre premiers points se jouent sur une **copie jetable** d'un classeur français, jamais sur
le classeur de travail ni sur le modèle.

30. **Renommage en place** : partir d'une copie portant `Paramètres` et `Récap`, avec un Seller ID
    et une marketplace renseignés. Lancer « Test connection » → l'onglet `Paramètres` est
    **renommé** `Settings` (et non doublé par un onglet vide), B3/B4/B5 sont intacts, et le test
    aboutit. Puis « Create / repair Summary » → `Récap` devient `Summary`. Vérifier qu'aucun
    onglet orphelin ne subsiste et que le nombre d'onglets n'a pas augmenté.
31. **Collision de noms** : sur une autre copie, créer à la main un onglet `Settings` vide à côté
    de `Paramètres`, puis lancer « Test connection » → le script écrit dans `Settings`, l'onglet
    `Paramètres` est **conservé tel quel** et aucune exception n'est levée.
32. **Formules du Summary après renommage** : les comptes du `Summary` restent justes — elles
    référencent `'ASINs'`, dont le nom n'a pas changé.
33. **Couleurs après renommage** : les six couleurs de l'onglet `ASINs` sont intactes et non
    dupliquées — les règles ne portent aucun nom d'onglet.
34. **Classeur neuf** (aucun onglet) : les trois onglets sont créés directement avec leurs noms
    anglais, `Settings` en première position et `Summary` en dernière.
35. Relire le menu, l'onglet `Settings`, les en-têtes d'`ASINs`, le dialogue des clés, le panneau
    et le `Summary` : **aucun texte français visible**. Le garde non-ASCII couvre le code, pas une
    tournure anglaise maladroite.
36. Format de date : colonne D d'`ASINs` et B15 de `Settings` affichent `yyyy-MM-dd HH:mm`
    (`:ss` pour B15). Les dates sont écrites en objets `Date` : **l'affichage suit le fuseau
    du classeur** (Fichier → Paramètres), pas celui du script — vérifié en réel le 17/11/2026
    sur le Sheet TEST passé en GMT-05 (Est) : « Last test » et « Checked on » affichaient
    02:52-02:53 quand il était 08:52-08:53 à Paris. Une copie de classeur hérite du fuseau du
    modèle : le levier pour un client hors de France est File → Settings → Time zone, à régler
    sur le Template officiel et à rappeler dans le guide client (note à ajouter au README lors
    de sa traduction en anglais). Le `timeZone` d'`appsscript.json` reste `Europe/Paris`,
    volontairement : il est sans effet sur l'affichage (aucun `Utilities.formatDate` dans le
    code).

### Étape 5 — résultat périmé (`onEdit`) et pluriels

À jouer sur le Sheet TEST, avec des lignes déjà vérifiées (statuts définitifs posés).

37. **Remplacement d'un ASIN** : remplacer l'ASIN d'une ligne vérifiée → B:D s'effacent sur
    cette seule ligne (et la couleur disparaît — mise en forme conditionnelle). Relancer
    « Check ASINs » → seule cette ligne est interrogée, ses voisines sont intactes.
38. **Même valeur retapée** : retaper le même ASIN, puis le retaper en minuscules avec des
    espaces → B:D **conservées** dans les deux cas (comparaison normalisée de `e.oldValue`).
39. **Collage multi-lignes** : coller plusieurs ASINs sur des lignes vérifiées → B:D effacées
    sur toutes les lignes collées, pas sur les voisines.
40. **Collage d'un bloc A:D** : coller un bloc couvrant A à D → B:D effacées malgré les
    valeurs collées en B:D (une édition qui touche A invalide la ligne).
41. **Édition hors colonne A** : modifier B, C ou D à la main → le trigger n'efface rien
    (seul le cas 19, taper `ERROR` en B, reste le moyen de forcer une reprise).
42. **Écritures du script** : lancer un run complet → les statuts écrits restent en place,
    les écritures du script ne déclenchent pas `onEdit`.
43. **Édition pendant un run** : pendant une tranche, remplacer l'ASIN d'une ligne encore en
    attente → au flush, cette ligne ne reçoit **pas** le résultat de l'ancien ASIN
    (`freshResults_`), sa colonne B reste vide, et le run suivant l'interroge avec le bon ASIN.
44. **Tri** : trier A:D par la colonne Status (A→Z puis Z→A) → aucun résultat effacé, chaque
    statut reste sur la ligne de son ASIN (le tri part en `onChange`, jamais en `onEdit`).
45. **Annuler** : modifier un ASIN puis Cmd+Z → l'ASIN d'origine revient en A, B:D encore
    vides ; un **second** Cmd+Z restaure aussi l'ancien résultat, en face du bon ASIN
    (l'effacement du script s'annule comme une étape de la pile). Vérifier qu'à aucun moment
    la ligne ne montre le nouvel ASIN avec l'ancien statut. Après un seul Cmd+Z, relancer
    suffit : la ligne est revérifiée.
46. **Pluriels** : un run d'un seul ASIN → toast « 1 ASIN checked. » ; panneau avec un seul
    ASIN → « 1 / 1 ASIN checked » puis « Finished: 1 ASIN checked. » ; aucune occurrence de
    « 1 ASINs » ni « 1 ERROR rows ».

### Étape 6 — marchés d'Amérique du Nord (US, CA, MX)

> **Points 47, 48, 50 et 51 joués en réel le 17/11/2026 sur le Sheet TEST.** Le **49 (appel NA
> réel) reste bloqué faute de compte NA actif** : aucun run n'a donc encore abouti sur l'hôte NA,
> seul son refus en 403 a été constaté. Tant que le 49 n'a pas été joué, ne rien annoncer aux
> clients, ne pas toucher au README (« Europe only for now » reste) ni au Template.

À jouer sur le **Sheet TEST uniquement**, jamais sur le Template ni sur un classeur client.

47. **Non-régression EU — à faire d'abord** : marché FR inchangé en B5, lancer un run sur des
    ASINs dont les statuts sont connus → **statuts identiques à ceux obtenus avant ce
    changement**. C'est le contrôle qui compte le plus, et c'est la seule preuve disponible que
    l'hôte EU est toujours celui qui répond : le script n'écrit rien dans les journaux
    d'exécution (aucun `Logger`, par la règle de non-fuite des secrets), donc l'hôte appelé ne
    s'y lit pas.
    Statuts de référence relevés le 17/11/2026 sur le Sheet TEST : `B0CHXMX9XC` → `ELIGIBLE`, et
    `B0ZZZZZZZZ` → `NOT_FOUND` avec le code `ASIN_NOT_FOUND`. La **cause de ce `ELIGIBLE` n'est
    pas établie** — changement côté Amazon, compte ou catalogue : rien dans ce dépôt ne permet de
    trancher. La non-régression du `conditionType` est tenue par la **fixture**
    `tests/fixtures/B0CHXMX9XC.json`, figée, et non par un run réel — les statuts vus en ligne
    suivent le catalogue d'Amazon et sont à relever à nouveau s'ils changent.
48. **Liste à 9 entrées** : lancer « Test connection » (ou ouvrir « Enter / edit keys ») → B5
    propose FR, DE, ES, IT, UK, NL, US, CA, MX dans cet ordre, et la valeur FR déjà saisie est
    **conservée**. Vérifier aussi qu'un classeur qui n'a reçu aucune de ces trois actions garde
    encore 6 entrées — c'est le comportement attendu, pas un bug.
49. **Appel NA réel** : choisir US avec un Seller ID et un `refresh_token` de la région NA → les
    ASINs sont **vérifiés normalement**, avec des statuts plausibles pour le catalogue américain
    et aucun `ERROR / NETWORK`. C'est la preuve recherchée : une réponse exploitable ne peut
    venir que de l'hôte NA, puisque c'est lui que le contexte porte. Ce test valide au passage
    qu'un jeton LWA du cache est accepté sur l'hôte NA, ce qui n'est pour l'instant qu'un
    raisonnement.
50. **Mauvaise région** : marché US avec des clés et un Seller ID EU → **constaté le 17/11/2026**,
    Amazon répond **HTTP 403** et le run s'arrête au **premier ASIN effectivement envoyé à
    Amazon**. L'alerte nomme le marché et sa région, et le code HTTP qu'elle affiche prouve à lui
    seul que l'hôte NA a répondu.
    Attention à la lecture du bilan : les lignes dont l'ASIN est **au format invalide** sont
    marquées `INVALID_ASIN` **localement, sans aucun appel** (`isValidAsinFormat_`), et comptées
    dans le « N ASIN checked » du compte-rendu. Un bilan non nul n'est donc pas la preuve qu'un
    statut est venu d'Amazon : ce qu'il faut vérifier, c'est qu'**aucune ligne au format valide
    n'a reçu de statut**.
    Le sens inverse (clés NA sur un marché EU) reste à jouer, et le **401 n'a pas été observé** —
    s'il apparaît un jour sur ce chemin, décider alors de l'ajouter à `RUN_REGION_HINT_CODES`.
51. **Marketplace vidée en pleine course** : vider B5 juste après avoir lancé « Check ASINs » (ou
    la vider puis relancer) → alerte « Configuration incomplete: marketplace is empty or not in
    the list (Settings tab, cell B5). », aucune exception dans les journaux d'exécution, et aucune
    ligne modifiée.
52. **Changement de marché** : passer de FR à US sur une liste déjà vérifiée, relancer → les
    lignes au statut définitif ne sont **pas** réinterrogées, donc la liste mélange deux marchés.
    Comportement attendu et documenté : « Clear results » avant de changer de marché.
53. **Aucun secret** : relire les cellules de l'onglet `Settings`, la colonne C d'`ASINs`, les
    alertes et les journaux d'exécution → aucun fragment de clé ni de jeton, et aucun corps de
    réponse Amazon. L'alerte de région ne doit citer que le code du marché et sa région.

### Étape 7 — « Run self-test »

À jouer sur le **Sheet TEST uniquement**.

**Bilan du 17/11/2026** — joués et validés : **54, 56, 57, 58, 59, 63 et 65**. Non joués, et
pourquoi :

| Point | Raison |
|---|---|
| 55 (sans clés) | « Clear keys » obligerait à ressaisir les trois clés pour un gain faible : l'étape 1 est triviale, et le rendu `SKIPPED` est déjà prouvé par les points 56 et 57 ainsi que par les tests automatiques |
| 60 (401 sur la sonde) | Non provoquable proprement — il faudrait un jeton accordé par LWA puis refusé par SP-API |
| 61 (sonde sur un marché NA) | Bloqué faute de compte NA actif |
| 62 (pendant un run) | À jouer avec une liste d'**au moins 200 ASINs**, pour que le run dure assez longtemps qu'on puisse cliquer pendant une tranche |
| 64 (liste B5 d'une ancienne copie) | Pas jouable proprement ; le point 48 de l'étape 6 couvre déjà le mécanisme d'`ensureSettingsSheet_` |

54. **Menu** : neuf entrées en trois groupes, « Run self-test » entre « Test connection » et
    « Clear keys ».
55. **Sans clés** → arrêt à l'étape 1, les clés manquantes sont nommées (`client_id`,
    `client_secret`, `refresh_token`), les étapes 2 à 4 sont en `SKIPPED`, **aucun appel réseau**,
    et B13:B15 sont inchangées.
56. **Clés erronées** → arrêt à l'étape 2 avec le message d'allowlist (`invalid_client` ou
    `invalid_grant`), aucune valeur affichée.
    Le champ à abîmer est le **deuxième du dialogue**, `client_secret` — le premier est
    `client_id`. Remplacer `client_id` donne de toute façon le même message, « client_id or
    client_secret invalid », donc le test reste valable dans les deux cas ; il faut seulement
    penser à **remettre la bonne valeur dans le champ qu'on a modifié**, un champ laissé vide
    signifiant « clé inchangée ».
57. **Seller ID vidé** (clés valides) → arrêt à l'étape 3 citant B4 ; puis **B5 vidée** → arrêt à
    l'étape 3 citant B5. Dans les deux cas, aucun appel SP-API.
58. **Configuration valide, marché FR** → les quatre étapes en `PASS`, l'étape 4 annonçant
    `HTTP 200` pour `B0ZZZZZZZZ`, et **un seul** appel SP-API.
59. **Mauvaise région** : marché US avec des clés EU → arrêt à l'étape 4 en `HTTP 403`, avec la
    piste région nommant US. C'est le scénario que « Test connection » ne sait pas voir : vérifier
    qu'il affiche « OK » juste avant, et que le self-test, lui, le rattrape.
60. **401 et jeton en cache** : non provoquable proprement (il faudrait un jeton accordé par LWA
    puis refusé par SP-API). Se relit dans le code — `selfTestProbeDetail_` traite
    `HTTP_UNAUTHORIZED` **avant** l'allowlist, et le message oriente vers « Test connection » puis
    la ressaisie d'une clé, jamais vers une relance qui resservirait le même jeton.
61. **Sonde sur un marché NA** : avec un compte NA actif, vérifier ce qu'Amazon répond à
    `B0ZZZZZZZZ` sur US, CA et MX. **Jamais constaté à ce jour** : le verdict doit rester un
    succès pour tout statut rendu, et si la réponse différait de l'Europe, mettre à jour la note
    de la sous-section « Run self-test ».
62. **Pendant un run** : lancer le self-test au milieu d'une tranche → la tranche va à son terme,
    aucun résultat perdu, aucun nouvel échange LWA (le jeton du run n'est pas purgé), et le
    « Stop » du panneau reste opérant.
63. **Aucune écriture** : après plusieurs self-tests, « ASINs » et « Summary » sont inchangés, et
    B13:B15 portent toujours le résultat du dernier « Test connection ».
64. **Liste B5** : sur une copie ancienne, un seul self-test régénère la liste à neuf entrées
    (effet de `ensureSettingsSheet_`), sans toucher la valeur déjà saisie.
65. **Aucun secret** dans l'alerte, les cellules et les journaux d'exécution.
