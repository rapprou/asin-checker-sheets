/**
 * Config.gs — constantes partagées et mise en place de l'onglet « Settings ».
 *
 * Aucune clé SP-API ne transite par ce fichier : l'onglet n'affiche que des
 * statuts (« saved » / « missing »), jamais une valeur ni un fragment.
 * Ce fichier ne dépend d'aucun autre.
 */

/** Nom affiché du module : menu et titre des notifications. */
var APP_NAME = 'ASIN Checker';

var SETTINGS_SHEET_NAME = 'Settings';

/**
 * Nom porté par cet onglet avant le passage de l'interface en anglais.
 * Voir findSheetWithLegacyName_ : il est renommé en place, jamais recréé.
 */
var LEGACY_SETTINGS_SHEET_NAME = 'Paramètres';

/**
 * Hôtes SP-API, un par région. Ils vivent ici et non dans Restrictions.gs :
 * l'hôte est une propriété de la marketplace choisie, et le sens des dépendances
 * va de Restrictions vers Config, jamais l'inverse.
 *
 * Le jeton LWA, lui, s'obtient sur api.amazon.com quelle que soit la région
 * (voir Lwa.gs) : la région n'entre dans aucun paramètre de cet échange.
 */
var SPAPI_HOST_EU = 'https://sellingpartnerapi-eu.amazon.com';
var SPAPI_HOST_NA = 'https://sellingpartnerapi-na.amazon.com';

/**
 * Marketplaces proposées dans la liste déroulante, avec leur région et l'hôte
 * SP-API qui va avec. Cette table est la source unique : l'hôte n'est plus une
 * constante globale du script.
 *
 * L'ordre compte — c'est celui de la liste déroulante. Les six marchés EU
 * restent en tête et à l'identique : la cellule B5 des classeurs clients porte
 * un libellé construit depuis cette table, et la liste déroulante stricte
 * refuserait une valeur qui n'y figure plus.
 */
var MARKETPLACES = [
  { code: 'FR', marketplaceId: 'A13V1IB3VIYZZH', region: 'EU', host: SPAPI_HOST_EU },
  { code: 'DE', marketplaceId: 'A1PA6795UKMFR9', region: 'EU', host: SPAPI_HOST_EU },
  { code: 'ES', marketplaceId: 'A1RKKUPIHCS9HS', region: 'EU', host: SPAPI_HOST_EU },
  { code: 'IT', marketplaceId: 'APJ6JRA9NG5V4', region: 'EU', host: SPAPI_HOST_EU },
  { code: 'UK', marketplaceId: 'A1F83G8C2ARO7P', region: 'EU', host: SPAPI_HOST_EU },
  { code: 'NL', marketplaceId: 'A1805IZSGTT6HS', region: 'EU', host: SPAPI_HOST_EU },
  { code: 'US', marketplaceId: 'ATVPDKIKX0DER', region: 'NA', host: SPAPI_HOST_NA },
  { code: 'CA', marketplaceId: 'A2EUQ1WTGCTBG2', region: 'NA', host: SPAPI_HOST_NA },
  { code: 'MX', marketplaceId: 'A1AM78C64UM0Y8', region: 'NA', host: SPAPI_HOST_NA }
];

/**
 * ASIN sonde du self-test. Inexistant volontairement : en Europe, Amazon répond
 * alors 200 avec le reasonCode ASIN_NOT_FOUND, un succès qui ne dépend ni du
 * catalogue ni du compte. Tout statut rendu par Amazon vaut succès pour le
 * self-test, donc la sonde n'a pas besoin d'exister.
 *
 * Son format est valide (10 caractères A-Z0-9) : sans cela elle serait rejetée
 * en local par isValidAsinFormat_ et l'étape 4 ne testerait plus rien.
 *
 * Attention, non constaté sur US, CA et MX : le comportement d'Amazon sur un
 * ASIN inexistant n'y a jamais été vérifié.
 */
var SELF_TEST_ASIN = 'B0ZZZZZZZZ';

/** Adresses des cellules de l'onglet « Settings ». */
var CELLS = {
  // Saisie libre, lue par l'étape 2 : aucun traitement en étape 1.
  vendorName: 'B3',
  sellerId: 'B4',
  marketplace: 'B5',
  clientIdStatus: 'B8',
  clientSecretStatus: 'B9',
  refreshTokenStatus: 'B10',
  testResult: 'B13',
  testDetail: 'B14',
  testDate: 'B15'
};

/** Libellés de la colonne A, réécrits à chaque passage (ils appartiennent au script). */
var SETTINGS_LABELS = [
  ['A1', 'ASIN Checker — Settings'],
  ['A3', 'Seller name'],
  ['A4', 'Seller ID'],
  ['A5', 'Marketplace'],
  ['A7', 'SP-API keys status'],
  ['A8', 'client_id'],
  ['A9', 'client_secret'],
  ['A10', 'refresh_token'],
  ['A12', 'Connection test'],
  ['A13', 'Result'],
  ['A14', 'Details'],
  ['A15', 'Last test']
];

var SETTINGS_TITLE_CELLS = ['A1', 'A7', 'A12'];

/** Plages écrites par le script, signalées visuellement comme non modifiables. */
var KEY_STATUS_RANGE = 'B8:B10';
var TEST_BLOCK_RANGE = 'B13:B15';
var MANAGED_RANGES = [KEY_STATUS_RANGE, TEST_BLOCK_RANGE];
var MANAGED_RANGE_NOTE = 'Managed by the script — do not edit.';
var MANAGED_RANGE_BACKGROUND = '#f3f3f3';

var STATUS_SAVED = 'saved';
var STATUS_MISSING = 'missing';

var TEST_RESULT_OK = 'OK';
/** « FAILED » et non « ERROR » : ERROR est un statut d'ASIN, pas un verdict de test. */
var TEST_RESULT_KO = 'FAILED';
var TEST_COLOR_OK = '#137333';
var TEST_COLOR_KO = '#b00020';

/** Format ISO : sans ambiguïté pour un lecteur anglophone, et il se trie bien. */
var TEST_DATE_FORMAT = 'yyyy-MM-dd HH:mm:ss';

var TOAST_SECONDS = 5;

/**
 * Crée l'onglet « Settings » s'il est absent et complète sa mise en page.
 * Idempotent : les valeurs saisies par l'utilisateur ne sont jamais écrasées.
 */
function ensureSettingsSheet_() {
  var sheet = getSettingsSheet_();
  buildSettingsLayout_(sheet);
  return sheet;
}

function getSettingsSheet_() {
  var spreadsheet = SpreadsheetApp.getActive();
  return findSheetWithLegacyName_(
          spreadsheet, SETTINGS_SHEET_NAME, LEGACY_SETTINGS_SHEET_NAME) ||
      spreadsheet.insertSheet(SETTINGS_SHEET_NAME, 0);
}

/**
 * Onglet cherché sous son nom actuel, puis sous son nom d'avant le passage de
 * l'interface en anglais.
 *
 * Un classeur créé par une version française porte encore « Paramètres » et
 * « Récap ». Sans cette résolution, getSheetByName() échouerait et un onglet
 * vide serait inséré à côté : le Seller ID, la marketplace et le nom du vendeur
 * (qui vivent dans la feuille, pas dans les propriétés) resteraient sur un
 * onglet orphelin, et l'utilisateur ne lirait qu'un « Seller ID is empty ».
 *
 * Renommage **en place** et non copie : Sheets réécrit alors de lui-même les
 * formules qui référençaient l'ancien nom, et rien de ce que l'utilisateur a
 * saisi ne bouge.
 *
 * Si les deux onglets existent, l'anglais gagne et le français est laissé tel
 * quel : setName() lève sur une collision de noms, et un onglet de
 * l'utilisateur ne doit jamais être supprimé par le script.
 *
 * Volontairement sans appel à SpreadsheetApp : le classeur est reçu en
 * paramètre, donc la résolution est testable hors Apps Script.
 *
 * @param {Spreadsheet} spreadsheet Classeur à interroger.
 * @param {string} name Nom attendu aujourd'hui.
 * @param {string} legacyName Nom porté par les versions antérieures.
 * @return {Sheet|null} null si aucun des deux noms n'existe.
 */
function findSheetWithLegacyName_(spreadsheet, name, legacyName) {
  var sheet = spreadsheet.getSheetByName(name);
  if (sheet) {
    return sheet;
  }
  var legacy = spreadsheet.getSheetByName(legacyName);
  if (legacy) {
    legacy.setName(name);
  }
  return legacy;
}

function buildSettingsLayout_(sheet) {
  SETTINGS_LABELS.forEach(function (label) {
    sheet.getRange(label[0]).setValue(label[1]);
  });
  SETTINGS_TITLE_CELLS.forEach(function (cell) {
    sheet.getRange(cell).setFontWeight('bold');
  });
  MANAGED_RANGES.forEach(function (range) {
    sheet.getRange(range)
        .setBackground(MANAGED_RANGE_BACKGROUND)
        .setNote(MANAGED_RANGE_NOTE);
  });
  applyMarketplaceValidation_(sheet);
  sheet.setColumnWidth(1, 170);
  sheet.setColumnWidth(2, 460);
}

/** Liste déroulante stricte sur la cellule marketplace ; la valeur déjà saisie est conservée. */
function applyMarketplaceValidation_(sheet) {
  var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(marketplaceLabels_(), true)
      .setAllowInvalid(false)
      .build();
  sheet.getRange(CELLS.marketplace).setDataValidation(rule);
}

function marketplaceLabels_() {
  return MARKETPLACES.map(marketplaceLabel_);
}

/** Libellé affiché : le marketplaceId reste visible, utile au support. */
function marketplaceLabel_(marketplace) {
  return marketplace.code + ' — ' + marketplace.marketplaceId;
}

function readSellerId_() {
  return readTrimmedCell_(CELLS.sellerId);
}

/** Marketplace sélectionnée, ou null si la cellule est vide ou hors liste. */
function readMarketplace_() {
  return findMarketplaceByLabel_(readTrimmedCell_(CELLS.marketplace));
}

/**
 * Entrée de MARKETPLACES portant exactement ce libellé, ou null.
 *
 * Comparaison stricte, et c'est voulu : ce libellé est la valeur écrite dans la
 * cellule B5 des classeurs clients. En changer le format rendrait illisibles
 * toutes les valeurs déjà saisies, et la liste déroulante stricte
 * (setAllowInvalid(false)) interdirait même de les retaper.
 *
 * Volontairement sans lecture de la feuille : le libellé est reçu en paramètre,
 * donc la résolution est testable hors Apps Script.
 *
 * @param {string} label Libellé lu dans la cellule, déjà débarrassé des espaces.
 * @return {Object|null} Entrée de MARKETPLACES, avec sa région et son hôte.
 */
function findMarketplaceByLabel_(label) {
  if (!label) {
    return null;
  }
  var matches = MARKETPLACES.filter(function (marketplace) {
    return marketplaceLabel_(marketplace) === label;
  });
  return matches.length === 1 ? matches[0] : null;
}

function readTrimmedCell_(cell) {
  return String(getSettingsSheet_().getRange(cell).getValue()).trim();
}

/** Affiche la présence de chaque clé, sans jamais en afficher la valeur. */
function writeKeyStatuses_(statuses) {
  var sheet = getSettingsSheet_();
  sheet.getRange(CELLS.clientIdStatus).setValue(statusLabel_(statuses.clientId));
  sheet.getRange(CELLS.clientSecretStatus).setValue(statusLabel_(statuses.clientSecret));
  sheet.getRange(CELLS.refreshTokenStatus).setValue(statusLabel_(statuses.refreshToken));
}

function statusLabel_(isSaved) {
  return isSaved ? STATUS_SAVED : STATUS_MISSING;
}

/** Écrit le résultat du test de connexion. Le message reçu ne contient aucun secret. */
function writeTestResult_(isOk, message) {
  var sheet = getSettingsSheet_();
  sheet.getRange(CELLS.testResult)
      .setValue(isOk ? TEST_RESULT_OK : TEST_RESULT_KO)
      .setFontWeight('bold')
      .setFontColor(isOk ? TEST_COLOR_OK : TEST_COLOR_KO);
  sheet.getRange(CELLS.testDetail).setValue(message).setWrap(true);
  sheet.getRange(CELLS.testDate)
      .setValue(new Date())
      .setNumberFormat(TEST_DATE_FORMAT);
}

/**
 * Remet à blanc le bloc « Connection test » : un résultat OK devient trompeur
 * dès que les clés ont été effacées.
 * Seul le contenu et la mise en forme du résultat sont retirés ; le fond gris et
 * la note des plages gérées par le script restent en place.
 */
function clearTestResult_() {
  getSettingsSheet_().getRange(TEST_BLOCK_RANGE)
      .clearContent()
      .setFontWeight('normal')
      .setFontColor(null);
}

/**
 * Notification courte en bas du classeur.
 * Ne jamais y faire passer autre chose qu'un texte générique : le détail va
 * dans l'onglet « Settings ».
 */
function showToast_(message, seconds) {
  SpreadsheetApp.getActive().toast(message, APP_NAME, seconds || TOAST_SECONDS);
}
