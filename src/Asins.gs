/**
 * Asins.gs — onglet « ASINs » : mise en page, lecture des lignes à traiter,
 * écriture des résultats, effacement.
 *
 * La colonne B (statut) est le seul marqueur d'avancement : une ligne dont B est
 * vide reste à vérifier. C'est ce qui permet à un run interrompu de reprendre
 * sans trou ni doublon.
 */

var ASIN_SHEET_NAME = 'ASINs';
var ASIN_HEADERS = ['ASIN', 'Statut', 'Code restriction', 'Vérifié le'];
var ASIN_FIRST_DATA_ROW = 2;

/** Colonnes de l'onglet, en numéros (1 = A). */
var ASIN_COLUMNS = { asin: 1, status: 2, code: 3, checkedAt: 4 };

/** Bloc écrit par un run : B à D. */
var ASIN_RESULT_FIRST_COLUMN = 2;
var ASIN_RESULT_WIDTH = 3;

/**
 * Statuts écrits en colonne B. Tous sont définitifs sauf ERROR, seul statut
 * repris automatiquement (voir isPendingStatus_).
 */
var ASIN_STATUS = {
  eligible: 'ELIGIBLE',
  approvalRequired: 'APPROVAL_REQUIRED',
  notEligible: 'NOT_ELIGIBLE',
  notFound: 'NOT_FOUND',
  invalidAsin: 'INVALID_ASIN',
  error: 'ERROR'
};

var ASIN_DATE_FORMAT = 'dd/MM/yyyy HH:mm';

var CLEAR_RESULTS_TITLE = 'Effacer les résultats';
var CLEAR_RESULTS_QUESTION =
    'Les colonnes Statut, Code restriction et Vérifié le vont être vidées pour ' +
    "toutes les lignes de l'onglet « ASINs ».\n\n" +
    'La colonne ASIN est conservée : la prochaine vérification repartira de zéro ' +
    'et réinterrogera Amazon pour chaque ligne.\n\n' +
    'Continuer ?';
var CLEAR_RESULTS_DONE_MESSAGE = 'Résultats effacés.';
var CLEAR_RESULTS_CANCELLED_MESSAGE = 'Effacement annulé : les résultats sont inchangés.';
var CLEAR_RESULTS_EMPTY_MESSAGE = 'Aucun résultat à effacer.';

/**
 * Crée l'onglet « ASINs » s'il est absent et complète sa mise en page.
 * Idempotent : seules la ligne d'en-têtes et la mise en forme sont réécrites,
 * jamais les lignes de données.
 */
function ensureAsinsSheet_() {
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getSheetByName(ASIN_SHEET_NAME) ||
      spreadsheet.insertSheet(ASIN_SHEET_NAME);
  buildAsinsLayout_(sheet);
  return sheet;
}

function buildAsinsLayout_(sheet) {
  sheet.getRange(1, 1, 1, ASIN_HEADERS.length)
      .setValues([ASIN_HEADERS])
      .setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(ASIN_COLUMNS.asin, 140);
  sheet.setColumnWidth(ASIN_COLUMNS.status, 180);
  sheet.setColumnWidth(ASIN_COLUMNS.code, 240);
  sheet.setColumnWidth(ASIN_COLUMNS.checkedAt, 140);

  var dataRows = sheet.getMaxRows() - ASIN_FIRST_DATA_ROW + 1;
  if (dataRows > 0) {
    sheet.getRange(ASIN_FIRST_DATA_ROW, ASIN_COLUMNS.checkedAt, dataRows, 1)
        .setNumberFormat(ASIN_DATE_FORMAT);
  }
}

/**
 * Lignes restant à vérifier : colonne A renseignée, et colonne B vide ou ERROR.
 *
 * ERROR est le seul statut transitoire (réseau, quota épuisé, 5xx) : il est
 * relancé automatiquement. ELIGIBLE, NOT_ELIGIBLE, APPROVAL_REQUIRED et
 * NOT_FOUND sont définitifs et ne sont jamais réinterrogés.
 *
 * La colonne A n'est pas réécrite : la normalisation ne sert qu'à la requête.
 * @return {Array<Object>} [{ row, asin, isRetry }] par numéro de ligne croissant.
 */
function readPendingRows_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < ASIN_FIRST_DATA_ROW) {
    return [];
  }

  var rowCount = lastRow - ASIN_FIRST_DATA_ROW + 1;
  var values = sheet.getRange(ASIN_FIRST_DATA_ROW, ASIN_COLUMNS.asin, rowCount, 2).getValues();
  var pending = [];
  values.forEach(function (row, index) {
    var asin = normalizeAsin_(row[0]);
    var status = String(row[1]).trim().toUpperCase();
    if (!asin || !isPendingStatus_(status)) {
      return;
    }
    pending.push({
      row: ASIN_FIRST_DATA_ROW + index,
      asin: asin,
      isRetry: status === ASIN_STATUS.error
    });
  });
  return pending;
}

function isPendingStatus_(status) {
  return !status || status === ASIN_STATUS.error;
}

/** Trim + majuscules. La cellule d'origine reste telle que le client l'a saisie. */
function normalizeAsin_(value) {
  return String(value).trim().toUpperCase();
}

/**
 * Écrit les résultats en colonnes B:D, un setValues() par bloc de lignes
 * consécutives. Les lignes déjà traitées intercalées ne sont jamais réécrites,
 * donc aucun read-modify-write n'est nécessaire.
 */
function writeResults_(sheet, results) {
  groupConsecutiveResults_(results).forEach(function (block) {
    var values = block.map(function (result) {
      return [result.status, result.code, result.checkedAt];
    });
    sheet.getRange(block[0].row, ASIN_RESULT_FIRST_COLUMN, values.length, ASIN_RESULT_WIDTH)
        .setValues(values);
  });
}

/** Découpe les résultats (lignes croissantes) en blocs de lignes contiguës. */
function groupConsecutiveResults_(results) {
  var blocks = [];
  results.forEach(function (result) {
    var current = blocks[blocks.length - 1];
    if (current && result.row === current[current.length - 1].row + 1) {
      current.push(result);
      return;
    }
    blocks.push([result]);
  });
  return blocks;
}

/**
 * Entrée de menu « Effacer les résultats ».
 * Vide les colonnes B, C et D ; la colonne A et les en-têtes sont conservés.
 */
function clearAsinResults() {
  var sheet = ensureAsinsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < ASIN_FIRST_DATA_ROW) {
    showToast_(CLEAR_RESULTS_EMPTY_MESSAGE);
    return;
  }

  var ui = SpreadsheetApp.getUi();
  var response = ui.alert(CLEAR_RESULTS_TITLE, CLEAR_RESULTS_QUESTION, ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) {
    showToast_(CLEAR_RESULTS_CANCELLED_MESSAGE);
    return;
  }

  var rowCount = lastRow - ASIN_FIRST_DATA_ROW + 1;
  sheet.getRange(ASIN_FIRST_DATA_ROW, ASIN_RESULT_FIRST_COLUMN, rowCount, ASIN_RESULT_WIDTH)
      .clearContent();
  showToast_(CLEAR_RESULTS_DONE_MESSAGE);
}
