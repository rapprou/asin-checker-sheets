/**
 * SelfTest.gs — entrée de menu « Run self-test ».
 *
 * Diagnostique la configuration en une passe, au prix d'un seul appel SP-API :
 * clés présentes, jeton LWA disponible, valeurs de l'onglet « Settings », puis
 * une sonde « restrictions ». Arrêt au premier échec, rapport en alerte.
 *
 * Ce fichier ne remplace pas ConnectionTest.gs : « Test connection » interroge
 * LWA hors cache et reste gratuit en quota SP-API.
 *
 * Trois interdits, qui tiennent tout le reste :
 *  - aucun verrou de script : le self-test ne lit ni n'écrit aucune ligne, et le
 *    prendre le rendrait inutilisable pendant un run, précisément quand on
 *    diagnostique ;
 *  - jamais clearCachedToken_() : un self-test cliqué pendant un run purgerait
 *    le jeton de ce run, qui devrait refaire un échange LWA ;
 *  - aucune écriture hors de ce que ensureSettingsSheet_() pose déjà. Le bloc
 *    « Connection test » (B13:B15) n'est jamais touché : un self-test en échec
 *    ne doit pas effacer un OK légitime.
 *
 * Aucun secret ne sort d'ici : les clés ne sont vues qu'à travers leurs libellés
 * d'absence, l'échec LWA passe par l'allowlist de Lwa.gs, et de la réponse
 * SP-API on n'affiche que le code HTTP.
 */

var SELF_TEST_TITLE = 'Self-test';

/** Verdicts, qui sont aussi les étiquettes affichées. */
var SELF_TEST_PASS = 'PASS';
var SELF_TEST_FAIL = 'FAIL';
var SELF_TEST_BUSY = 'BUSY';
var SELF_TEST_SKIPPED = 'SKIPPED';

/**
 * Libellés des quatre étapes, dans l'ordre d'exécution. Le rapport les prend
 * par leur rang : une étape ne porte donc jamais son libellé en double, et une
 * étape non atteinte reste nommée.
 */
var SELF_TEST_STEP_LABELS = [
  'SP-API keys stored',
  'LWA access token',
  'Settings values (Seller ID, marketplace)',
  'SP-API restrictions call'
];

var SELF_TEST_PASSED_SUMMARY =
    'Self-test passed: every step answered. The configuration is usable.';
var SELF_TEST_BUSY_SUMMARY =
    'Self-test inconclusive: Amazon is throttling. This is a quota state, not a ' +
    'configuration problem.';
var SELF_TEST_FAILED_PREFIX = 'Self-test stopped at step ';

var SELF_TEST_KEYS_OK = 'all three keys are stored.';
var SELF_TEST_KEYS_MISSING_PREFIX = 'missing keys: ';
var SELF_TEST_KEYS_MISSING_SUFFIX = ' (menu "ASIN Checker" -> "Enter / edit keys").';

/**
 * Le jeton peut venir du cache (50 min), donc cette étape ne prouve pas que LWA
 * a répondu à l'instant. Le dire plutôt que de laisser croire le contraire.
 */
var SELF_TEST_TOKEN_OK =
    'an access token is available. It may come from the 50-minute cache, so this ' +
    'step alone does not prove that Amazon answered just now - "Test connection" does.';

var SELF_TEST_SELLER_ID_MISSING = 'Seller ID is empty (Settings tab, cell ';
var SELF_TEST_MARKETPLACE_MISSING =
    'marketplace is empty or not in the list (Settings tab, cell ';

var SELF_TEST_PROBE_OK_PREFIX = 'Amazon answered about the probe ASIN (HTTP ';

var SELF_TEST_BUSY_MESSAGE =
    'HTTP 429 - SP-API is throttling. Run the self-test again in a minute; the ' +
    'probe makes a single request and never waits.';

/**
 * 401 sur la sonde : le jeton vient peut-être du cache et n'est pas forcément la
 * preuve que les clés sont refusées. Le self-test ne relance pas avec un jeton
 * frais, car l'obtenir passerait par clearCachedToken_() (voir
 * checkAsinWithRefresh_), ce qui casserait un run en cours.
 *
 * « Test connection » diagnostique les clés mais ne vide pas le cache : seule
 * une ressaisie de clé (saveKeys) ou l'expiration écarte le jeton en cause.
 */
var SELF_TEST_UNAUTHORIZED_MESSAGE =
    'HTTP 401 - the token was refused. This may be a stale cached token rather ' +
    'than a key problem.\n\nRun "Test connection" to check the keys themselves ' +
    '(it never uses the cache). To drop the cached token, re-enter a key via ' +
    '"Enter / edit keys", or wait up to 50 minutes, then run the self-test again.';

var SELF_TEST_NETWORK_MESSAGE =
    'No answer from the SP-API host: network unavailable or UrlFetch quota reached.';

/**
 * Entrée de menu. Seule fonction globale de ce fichier.
 *
 * ensureSettingsSheet_() est appelé comme par les trois autres entrées du même
 * groupe : idempotent, il n'écrit que ce qui appartient au script et régénère au
 * passage la liste déroulante de la marketplace.
 */
function runSelfTest() {
  ensureSettingsSheet_();
  var report = selfTestReport_(selfTestSteps_());
  var ui = SpreadsheetApp.getUi();
  ui.alert(SELF_TEST_TITLE, report, ui.ButtonSet.OK);
}

/**
 * Les étapes franchies, dans l'ordre, la dernière portant la cause de l'arrêt.
 * Arrêt au premier échec : le tableau rendu peut compter moins de quatre entrées.
 *
 * Le Seller ID est contrôlé à l'étape 3 et non à l'étape 1 : l'ordre demandé est
 * clés, puis LWA, puis feuille, et un Seller ID vide ferait échouer la sonde en
 * 400 sans rien expliquer. validateSettings_() n'est pas réutilisable ici — elle
 * vérifie les trois choses d'un coup et signalerait la marketplace avant LWA.
 *
 * @return {Array<Object>} { verdict, detail } par étape atteinte.
 */
function selfTestSteps_() {
  var steps = [];

  var missingKeys = missingKeyLabels_();
  if (missingKeys.length > 0) {
    steps.push(selfTestStep_(SELF_TEST_FAIL, SELF_TEST_KEYS_MISSING_PREFIX +
        missingKeys.join(', ') + SELF_TEST_KEYS_MISSING_SUFFIX));
    return steps;
  }
  steps.push(selfTestStep_(SELF_TEST_PASS, SELF_TEST_KEYS_OK));

  // getAccessToken_ lit les clés lui-même : getCredentials_ garde ses appelants.
  var token = getAccessToken_();
  if (!token.ok) {
    // lwaErrorMessage_ passe par une allowlist : aucun secret, aucun corps de réponse.
    steps.push(selfTestStep_(SELF_TEST_FAIL, lwaErrorMessage_(token)));
    return steps;
  }
  steps.push(selfTestStep_(SELF_TEST_PASS, SELF_TEST_TOKEN_OK));

  var sellerId = readSellerId_();
  if (!sellerId) {
    steps.push(selfTestStep_(SELF_TEST_FAIL,
        SELF_TEST_SELLER_ID_MISSING + CELLS.sellerId + ').'));
    return steps;
  }
  var marketplace = readMarketplace_();
  if (!marketplace) {
    steps.push(selfTestStep_(SELF_TEST_FAIL,
        SELF_TEST_MARKETPLACE_MISSING + CELLS.marketplace + ').'));
    return steps;
  }
  steps.push(selfTestStep_(SELF_TEST_PASS, selfTestMarketplaceDetail_(marketplace)));

  // Un seul appel, sans backoff : fetchRestrictions_ et non checkAsin_.
  var context = buildContext_(token, marketplace, sellerId);
  var response = fetchRestrictions_(SELF_TEST_ASIN, context);
  steps.push(selfTestStep_(
      selfTestProbeVerdict_(response.httpCode),
      selfTestProbeDetail_(response.httpCode, runFatal_(response.httpCode, context))));
  return steps;
}

/** Une étape du rapport. Fonction pure. */
function selfTestStep_(verdict, detail) {
  return { verdict: verdict, detail: detail };
}

/**
 * Marketplace retenue, nommée avec sa région. Fonction pure.
 * La région vient de MARKETPLACES, jamais d'une réponse Amazon.
 */
function selfTestMarketplaceDetail_(marketplace) {
  var region = RUN_REGION_NAMES[marketplace.region];
  return 'Seller ID set, marketplace ' + marketplace.code +
      (region ? ' (' + region + ')' : '') + '.';
}

/**
 * Verdict de la sonde. Fonction pure.
 *
 * Tout statut rendu par Amazon est un succès, l'étape ne teste que l'accès : un
 * 200 comme un 404 prouvent que l'hôte a répondu sur l'ASIN. Le 429 est un état
 * de quota et non une erreur de configuration, d'où un verdict à part — et
 * fetchRestrictions_ ne faisant aucun backoff, un self-test ne dort jamais.
 */
function selfTestProbeVerdict_(httpCode) {
  if (httpCode === HTTP_OK || httpCode === HTTP_NOT_FOUND) {
    return SELF_TEST_PASS;
  }
  if (httpCode === HTTP_TOO_MANY_REQUESTS) {
    return SELF_TEST_BUSY;
  }
  return SELF_TEST_FAIL;
}

/**
 * Détail de la sonde. Fonction pure, et aucun corps de réponse : le code HTTP
 * seul, puis les messages d'allowlist déjà en place.
 *
 * Le 401 est traité avant l'allowlist : RUN_FATAL_MESSAGES y voit des clés
 * refusées, ce qui serait trompeur pour un jeton venu du cache.
 *
 * @param {number} httpCode Code rendu par fetchRestrictions_.
 * @param {Object} fatal { httpCode, marketplaceCode, region } — jamais le jeton.
 */
function selfTestProbeDetail_(httpCode, fatal) {
  var verdict = selfTestProbeVerdict_(httpCode);
  if (verdict === SELF_TEST_PASS) {
    return SELF_TEST_PROBE_OK_PREFIX + httpCode + ').';
  }
  if (verdict === SELF_TEST_BUSY) {
    return SELF_TEST_BUSY_MESSAGE;
  }
  if (httpCode === HTTP_UNAUTHORIZED) {
    return SELF_TEST_UNAUTHORIZED_MESSAGE;
  }
  if (httpCode === SPAPI_NETWORK_ERROR_CODE) {
    return SELF_TEST_NETWORK_MESSAGE;
  }
  var message = RUN_FATAL_MESSAGES[httpCode];
  if (!message) {
    return 'Amazon refused the request (HTTP ' + httpCode + ').';
  }
  // regionHint_ ne parle que sur 400 et 403, et nomme le marché de la table.
  return message + regionHint_(fatal);
}

/**
 * Rapport affiché. Fonction pure.
 * Les étapes non atteintes sont listées en SKIPPED : le lecteur voit où le
 * diagnostic s'est arrêté, et ce qui n'a donc pas été vérifié.
 */
function selfTestReport_(steps) {
  var lines = [selfTestSummary_(steps), ''];
  steps.forEach(function (step, index) {
    lines.push(selfTestLine_(index, step.verdict, step.detail));
  });
  for (var index = steps.length; index < SELF_TEST_STEP_LABELS.length; index++) {
    lines.push(selfTestLine_(index, SELF_TEST_SKIPPED, ''));
  }
  return lines.join('\n');
}

function selfTestLine_(index, verdict, detail) {
  return (index + 1) + '. ' + verdict + ' - ' + SELF_TEST_STEP_LABELS[index] +
      (detail ? ': ' + detail : '');
}

/** Première ligne du rapport. Fonction pure. */
function selfTestSummary_(steps) {
  var total = SELF_TEST_STEP_LABELS.length;
  if (steps.length === 0) {
    return SELF_TEST_FAILED_PREFIX + '1 of ' + total + '.';
  }
  var last = steps[steps.length - 1];
  if (last.verdict === SELF_TEST_FAIL) {
    return SELF_TEST_FAILED_PREFIX + steps.length + ' of ' + total + '.';
  }
  if (last.verdict === SELF_TEST_BUSY) {
    return SELF_TEST_BUSY_SUMMARY;
  }
  return SELF_TEST_PASSED_SUMMARY;
}
