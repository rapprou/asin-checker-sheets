/**
 * Config.gs — constantes partagées et mise en place de l'onglet « Paramètres ».
 *
 * Aucune clé SP-API ne transite par ce fichier : l'onglet n'affiche que des
 * statuts (« enregistrée » / « manquante »), jamais une valeur ni un fragment.
 * Ce fichier ne dépend d'aucun autre.
 */

/** Nom affiché du module : menu et titre des notifications. */
var APP_NAME = 'ASIN Checker';

var SETTINGS_SHEET_NAME = 'Paramètres';

/** Marketplaces Amazon Europe proposées dans la liste déroulante. */
var MARKETPLACES = [
  { code: 'FR', marketplaceId: 'A13V1IB3VIYZZH' },
  { code: 'DE', marketplaceId: 'A1PA6795UKMFR9' },
  { code: 'ES', marketplaceId: 'A1RKKUPIHCS9HS' },
  { code: 'IT', marketplaceId: 'APJ6JRA9NG5V4' },
  { code: 'UK', marketplaceId: 'A1F83G8C2ARO7P' },
  { code: 'NL', marketplaceId: 'A1805IZSGTT6HS' }
];

/** Adresses des cellules de l'onglet « Paramètres ». */
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
  ['A1', 'ASIN Checker — Paramètres'],
  ['A3', 'Nom du vendeur'],
  ['A4', 'Seller ID'],
  ['A5', 'Marketplace'],
  ['A7', 'État des clés SP-API'],
  ['A8', 'client_id'],
  ['A9', 'client_secret'],
  ['A10', 'refresh_token'],
  ['A12', 'Test de connexion'],
  ['A13', 'Résultat'],
  ['A14', 'Détail'],
  ['A15', 'Dernier test']
];

var SETTINGS_TITLE_CELLS = ['A1', 'A7', 'A12'];

/** Plages écrites par le script, signalées visuellement comme non modifiables. */
var KEY_STATUS_RANGE = 'B8:B10';
var TEST_BLOCK_RANGE = 'B13:B15';
var MANAGED_RANGES = [KEY_STATUS_RANGE, TEST_BLOCK_RANGE];
var MANAGED_RANGE_NOTE = 'Géré par le script — ne pas modifier.';
var MANAGED_RANGE_BACKGROUND = '#f3f3f3';

var STATUS_SAVED = 'enregistrée';
var STATUS_MISSING = 'manquante';

var TEST_RESULT_OK = 'OK';
var TEST_RESULT_KO = 'KO';
var TEST_COLOR_OK = '#137333';
var TEST_COLOR_KO = '#b00020';

var TEST_DATE_FORMAT = 'dd/MM/yyyy HH:mm:ss';

var TOAST_SECONDS = 5;

/**
 * Crée l'onglet « Paramètres » s'il est absent et complète sa mise en page.
 * Idempotent : les valeurs saisies par l'utilisateur ne sont jamais écrasées.
 */
function ensureSettingsSheet() {
  var sheet = getSettingsSheet_();
  buildSettingsLayout_(sheet);
  return sheet;
}

function getSettingsSheet_() {
  var spreadsheet = SpreadsheetApp.getActive();
  return spreadsheet.getSheetByName(SETTINGS_SHEET_NAME) ||
      spreadsheet.insertSheet(SETTINGS_SHEET_NAME, 0);
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
  var label = readTrimmedCell_(CELLS.marketplace);
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
 * Remet à blanc le bloc « Test de connexion » : un résultat OK devient trompeur
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
 * dans l'onglet « Paramètres ».
 */
function showToast_(message) {
  SpreadsheetApp.getActive().toast(message, APP_NAME, TOAST_SECONDS);
}
