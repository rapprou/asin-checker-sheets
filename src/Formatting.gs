/**
 * Formatting.gs — couleurs par statut dans l'onglet « ASINs ».
 *
 * Mise en forme *conditionnelle*, et non des setBackground cellule par cellule :
 * une ligne recolorée dès que sa colonne B change, aucune écriture de style à
 * chaque run, et un « Effacer les résultats » rend les lignes blanches sans
 * travail supplémentaire.
 *
 * Les règles sont posées sur A2:D (ligne entière) avec une formule testant $B2,
 * donc le statut colore toute la ligne.
 */

/**
 * Colonne du statut dans la formule des règles. Doit correspondre à
 * ASIN_COLUMNS.status (Asins.gs) : B = 2.
 */
var STATUS_FORMULA_COLUMN = 'B';

var FORMATTING_DONE_MESSAGE = 'Couleurs par statut appliquées à l\'onglet « ASINs ».';

/**
 * Entrée de menu « Appliquer les couleurs ».
 * ensureAsinsSheet_() crée l'onglet au besoin et recale la mise en forme :
 * les règles sont posées par buildAsinsLayout_().
 */
function applyStatusFormatting() {
  ensureAsinsSheet_();
  showToast_(FORMATTING_DONE_MESSAGE);
}

/**
 * Remplace nos règles par des règles à jour, sans toucher aux autres.
 *
 * Idempotent : les règles déjà posées par le script sont reconnues à leur
 * formule (isStatusFormatFormula_) et retirées avant d'être réécrites, donc une
 * relance ne duplique rien. Toute autre règle de l'onglet — posée à la main par
 * le client — est conservée, et replacée avant les nôtres.
 */
function setStatusFormatRules_(sheet) {
  var foreign = sheet.getConditionalFormatRules().filter(function (rule) {
    return !isStatusFormatRule_(rule);
  });
  sheet.setConditionalFormatRules(foreign.concat(statusFormatRules_(sheet)));
}

/** Une règle par statut, toutes sur la même plage A2:D. */
function statusFormatRules_(sheet) {
  var rowCount = sheet.getMaxRows() - ASIN_FIRST_DATA_ROW + 1;
  if (rowCount <= 0) {
    return [];
  }

  var range = sheet.getRange(
      ASIN_FIRST_DATA_ROW, ASIN_COLUMNS.asin, rowCount, ASIN_HEADERS.length);
  return statusStyles_().map(function (style) {
    var builder = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(statusFormatFormula_(style.status))
        .setBackground(style.background)
        .setFontColor(style.fontColor)
        .setRanges([range]);
    if (style.bold) {
      builder.setBold(true);
    }
    return builder.build();
  });
}

/**
 * Formule d'une de nos règles. Le $ fige la colonne du statut ; le numéro de
 * ligne reste relatif à la première ligne de la plage, donc chaque ligne est
 * évaluée sur son propre statut.
 */
function statusFormatFormula_(status) {
  return '=$' + STATUS_FORMULA_COLUMN + ASIN_FIRST_DATA_ROW + '="' + status + '"';
}

/** La règle vient-elle de nous ? Sert à ne jamais retirer une règle étrangère. */
function isStatusFormatRule_(rule) {
  var condition = rule.getBooleanCondition();
  if (!condition ||
      condition.getCriteriaType() !== SpreadsheetApp.BooleanCriteria.CUSTOM_FORMULA) {
    return false;
  }
  return isStatusFormatFormula_(condition.getCriteriaValues()[0]);
}

/**
 * Partie pure de la reconnaissance, testable hors Apps Script.
 * La comparaison est faite sans espaces et en majuscules : Sheets peut
 * renormaliser la formule qu'on lui a donnée, et deux écritures de la même
 * règle ne doivent pas produire un doublon.
 */
function isStatusFormatFormula_(formula) {
  var normalized = normalizeFormula_(formula);
  return statusStyles_().some(function (style) {
    return normalizeFormula_(statusFormatFormula_(style.status)) === normalized;
  });
}

function normalizeFormula_(formula) {
  return String(formula).replace(/\s+/g, '').toUpperCase();
}
