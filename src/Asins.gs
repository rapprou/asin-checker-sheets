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

  // Couleurs par statut (Formatting.gs) : posées dès la création de l'onglet,
  // et recalées à chaque passage.
  setStatusFormatRules_(sheet);
}

/**
 * Lignes restant à vérifier, lues en A:D.
 * @param {number} chainStart Voir selectPendingRows_.
 * @return {Object} { rows, undatedRetries }
 */
function readPendingRows_(sheet, chainStart) {
  var lastRow = sheet.getLastRow();
  if (lastRow < ASIN_FIRST_DATA_ROW) {
    return { rows: [], undatedRetries: 0 };
  }

  var rowCount = lastRow - ASIN_FIRST_DATA_ROW + 1;
  var values = sheet
      .getRange(ASIN_FIRST_DATA_ROW, ASIN_COLUMNS.asin, rowCount, ASIN_HEADERS.length)
      .getValues();
  return selectPendingRows_(values, ASIN_FIRST_DATA_ROW, chainStart);
}

/**
 * Sélection des lignes à traiter. Fonction pure, donc testable hors Apps Script.
 *
 * Une ligne est retenue si sa colonne A est renseignée et que sa colonne B est
 * vide ou vaut ERROR. ELIGIBLE, NOT_ELIGIBLE, APPROVAL_REQUIRED, NOT_FOUND et
 * INVALID_ASIN sont définitifs et ne sont jamais réinterrogés.
 *
 * Un ERROR n'est repris que si sa date de vérification (colonne D) est
 * antérieure à `chainStart`, l'instant du premier appel d'une chaîne de runs.
 * C'est ce qui empêche le panneau de boucler : un ERROR écrit *pendant* la
 * chaîne n'est pas retenté par les tranches suivantes, alors qu'un ERROR plus
 * ancien l'est, même atteint à la troisième tranche. Les runs lancés depuis le
 * menu passent chainStart = maintenant, donc reprennent tous les ERROR.
 *
 * Une date illisible (cellule vide, texte saisi à la main) fait traiter la
 * ligne comme ancienne : on préfère une requête de trop à un ERROR jamais
 * repris. Ces lignes sont comptées pour être signalées dans le bilan du run —
 * le projet n'a volontairement aucun logger (règle de non-fuite des secrets).
 *
 * La colonne A n'est pas réécrite : la normalisation ne sert qu'à la requête.
 *
 * @param {Array<Array>} values Lignes A:D, dans l'ordre de la feuille.
 * @param {number} firstRow Numéro de la première ligne de `values`.
 * @param {number} chainStart Horodatage (ms) du début de la chaîne.
 * @return {Object} { rows: [{ row, asin, isRetry }], undatedRetries }
 */
function selectPendingRows_(values, firstRow, chainStart) {
  var rows = [];
  var undatedRetries = 0;

  values.forEach(function (value, index) {
    var asin = normalizeAsin_(value[ASIN_COLUMNS.asin - 1]);
    var status = String(value[ASIN_COLUMNS.status - 1]).trim().toUpperCase();
    if (!asin || !isPendingStatus_(status)) {
      return;
    }

    var isRetry = status === ASIN_STATUS.error;
    if (isRetry) {
      var checkedAt = checkedAtMillis_(value[ASIN_COLUMNS.checkedAt - 1]);
      if (checkedAt === null) {
        undatedRetries++;
      } else if (checkedAt >= chainStart) {
        // ERROR écrit par cette chaîne : le reprendre maintenant ferait boucler.
        return;
      }
    }

    rows.push({ row: firstRow + index, asin: asin, isRetry: isRetry });
  });

  return { rows: rows, undatedRetries: undatedRetries };
}

/**
 * Horodatage d'une cellule de la colonne D, ou null si elle n'en porte pas.
 * Seule une vraie date compte : du texte saisi à la main n'est pas interprété.
 */
function checkedAtMillis_(value) {
  if (!(value instanceof Date)) {
    return null;
  }
  var millis = value.getTime();
  return isNaN(millis) ? null : millis;
}

function isPendingStatus_(status) {
  return !status || status === ASIN_STATUS.error;
}

/**
 * Comptes par statut pour le panneau, en une lecture de A:B. Fonction pure.
 *
 * « pending » compte toutes les lignes que isPendingStatus_ retient (vides et
 * ERROR), sans tenir compte de chainStart : c'est le travail restant affiché,
 * la même définition que « À traiter » du Récap. Une tranche donnée peut donc
 * finir avec pending > 0 sans rien avoir laissé à faire dans sa chaîne.
 *
 * @param {Array<Array>} values Lignes A:B.
 * @return {Object} { total, pending, counts }
 */
function countStatuses_(values) {
  var counts = {};
  statusList_().forEach(function (status) {
    counts[status] = 0;
  });

  var total = 0;
  var pending = 0;
  values.forEach(function (value) {
    if (!normalizeAsin_(value[ASIN_COLUMNS.asin - 1])) {
      return;
    }
    total++;
    var status = String(value[ASIN_COLUMNS.status - 1]).trim().toUpperCase();
    if (counts.hasOwnProperty(status)) {
      counts[status]++;
    }
    if (isPendingStatus_(status)) {
      pending++;
    }
  });

  return { total: total, pending: pending, counts: counts };
}

/**
 * Comptes à jour, pour le sondage du panneau. Volontairement léger : une seule
 * lecture de A:B, aucune écriture, aucun verrou, aucun appel SP-API — il est
 * appelé toutes les 5 s pendant qu'un run tourne.
 */
function readStatusCounts_(sheet) {
  var lastRow = sheet ? sheet.getLastRow() : 0;
  if (!sheet || lastRow < ASIN_FIRST_DATA_ROW) {
    return countStatuses_([]);
  }
  var rowCount = lastRow - ASIN_FIRST_DATA_ROW + 1;
  return countStatuses_(
      sheet.getRange(ASIN_FIRST_DATA_ROW, ASIN_COLUMNS.asin, rowCount, 2).getValues());
}

/** L'onglet s'il existe, sans le créer ni toucher à sa mise en page. */
function findAsinsSheet_() {
  return SpreadsheetApp.getActive().getSheetByName(ASIN_SHEET_NAME);
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
