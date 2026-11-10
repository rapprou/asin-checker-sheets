/**
 * Summary.gs — onglet « Récap ».
 *
 * L'onglet ne contient que des formules : le script n'y écrit aucun compte.
 * Conséquence voulue — les chiffres suivent l'onglet « ASINs » en direct, même
 * quand le client efface une cellule à la main, et un Récap jamais régénéré
 * reste juste.
 *
 * Les formules sont écrites en syntaxe anglaise avec la virgule comme
 * séparateur d'arguments : setFormula() attend toujours cette forme, quelle
 * que soit la locale du classeur, et Sheets l'affiche ensuite traduite.
 *
 * Les lignes de statuts sont générées depuis statusList_() (Statuses.gs) et
 * colorées par statusStyle_() : aucun statut ni aucune couleur en dur ici.
 */

var SUMMARY_SHEET_NAME = 'Récap';
var SUMMARY_TITLE = 'ASIN Checker — Récap';
var SUMMARY_TITLE_CELL = 'A1';

var SUMMARY_HEADERS = ['Statut', 'Nombre', '%'];
var SUMMARY_WIDTH = 3;

/** Ligne d'en-têtes du tableau, puis première ligne de statut. */
var SUMMARY_HEADER_ROW = 3;
var SUMMARY_FIRST_STATUS_ROW = 4;

var SUMMARY_COUNT_COLUMN = 'B';
var SUMMARY_SHARE_FORMAT = '0.0%';

var SUMMARY_TOTAL_LABEL = 'Total ASINs';
var SUMMARY_PENDING_LABEL = 'À traiter';
var SUMMARY_LAST_RUN_LABEL = 'Dernier passage';

var SUMMARY_DONE_MESSAGE = 'Onglet « Récap » à jour.';

/** Entrée de menu « Créer / réparer le Récap ». */
function ensureSummarySheet() {
  buildSummaryLayout_(getSummarySheet_());
  showToast_(SUMMARY_DONE_MESSAGE);
}

function getSummarySheet_() {
  var spreadsheet = SpreadsheetApp.getActive();
  return spreadsheet.getSheetByName(SUMMARY_SHEET_NAME) ||
      spreadsheet.insertSheet(SUMMARY_SHEET_NAME, spreadsheet.getNumSheets());
}

/**
 * Réécrit l'onglet en entier à partir du plan.
 *
 * Le bloc A:C est effacé d'abord (contenu et mise en forme) : c'est ce qui rend
 * l'opération réparatrice et non seulement idempotente — une ligne laissée par
 * une version précédente, ou une cellule modifiée à la main, disparaît. Tout
 * l'onglet appartient au script, rien d'y saisir n'est conservé.
 */
function buildSummaryLayout_(sheet) {
  var plan = summaryPlan_();

  sheet.getRange(1, 1, sheet.getMaxRows(), SUMMARY_WIDTH).clear();
  sheet.getRange(SUMMARY_TITLE_CELL).setValue(SUMMARY_TITLE).setFontWeight('bold');
  sheet.getRange(SUMMARY_HEADER_ROW, 1, 1, SUMMARY_HEADERS.length)
      .setValues([SUMMARY_HEADERS])
      .setFontWeight('bold');

  plan.statusLines.forEach(function (line) {
    writeSummaryStatusLine_(sheet, line);
  });
  plan.totalLines.forEach(function (line) {
    sheet.getRange(line.row, 1).setValue(line.label).setFontWeight('bold');
    sheet.getRange(line.row, 2).setFormula(line.formula);
  });
  sheet.getRange(plan.lastRunRow, 2).setNumberFormat(ASIN_DATE_FORMAT);

  sheet.setFrozenRows(SUMMARY_HEADER_ROW);
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 110);
  sheet.setColumnWidth(3, 90);
}

/** Une ligne de statut : libellé, compte, part, et les couleurs du statut. */
function writeSummaryStatusLine_(sheet, line) {
  sheet.getRange(line.row, 1).setValue(line.status);
  sheet.getRange(line.row, 2).setFormula(line.countFormula);
  sheet.getRange(line.row, 3)
      .setFormula(line.shareFormula)
      .setNumberFormat(SUMMARY_SHARE_FORMAT);

  var style = statusStyle_(line.status);
  sheet.getRange(line.row, 1, 1, SUMMARY_WIDTH)
      .setBackground(style.background)
      .setFontColor(style.fontColor)
      .setFontWeight(style.bold ? 'bold' : 'normal');
}

/**
 * Plan de l'onglet : quelle formule dans quelle cellule. Fonction pure, donc
 * testable hors Apps Script — c'est là que vivent toutes les formules.
 *
 * @return {Object} { statusLines, totalLines, lastRunRow }
 */
function summaryPlan_() {
  var statuses = statusList_();
  var totalRow = SUMMARY_FIRST_STATUS_ROW + statuses.length + 1;
  var totalCell = '$' + SUMMARY_COUNT_COLUMN + '$' + totalRow;

  var statusLines = statuses.map(function (status, index) {
    var row = SUMMARY_FIRST_STATUS_ROW + index;
    return {
      row: row,
      status: status,
      countFormula: statusCountFormula_(status),
      // Protection contre la division par zéro : un classeur vide affiche 0 %
      // et non #DIV/0!.
      shareFormula: '=IFERROR(' + SUMMARY_COUNT_COLUMN + row + '/' + totalCell + ',0)'
    };
  });

  return {
    statusLines: statusLines,
    totalLines: [
      { row: totalRow, label: SUMMARY_TOTAL_LABEL, formula: totalFormula_() },
      {
        row: totalRow + 1,
        label: SUMMARY_PENDING_LABEL,
        formula: pendingFormula_(totalCell, statusLines)
      },
      { row: totalRow + 2, label: SUMMARY_LAST_RUN_LABEL, formula: lastRunFormula_() }
    ],
    lastRunRow: totalRow + 2
  };
}

/** Lignes portant un ASIN et ce statut exact. */
function statusCountFormula_(status) {
  return '=COUNTIFS(' + asinRange_('A') + ',"<>",' + asinRange_('B') + ',"' + status + '")';
}

function totalFormula_() {
  return '=COUNTA(' + asinRange_('A') + ')';
}

/**
 * À traiter = total − somme des statuts définitifs.
 *
 * Compté par soustraction, et non en additionnant les lignes vides et les
 * ERROR : c'est la définition exacte de ce que le prochain run reprendra
 * (isPendingStatus_), y compris une colonne B vide, que COUNTIFS ne sait pas
 * distinguer d'une ligne sans ASIN. Les statuts définitifs sont ceux que
 * isPendingStatus_ refuse — ERROR n'en fait donc pas partie et reste compté
 * comme à traiter.
 */
function pendingFormula_(totalCell, statusLines) {
  var definitive = statusLines.filter(function (line) {
    return !isPendingStatus_(line.status);
  });
  return '=' + totalCell + '-SUM(' + definitive.map(function (line) {
    return SUMMARY_COUNT_COLUMN + line.row;
  }).join(',') + ')';
}

/**
 * Date du dernier ASIN vérifié. MAX() sur une colonne vide renvoie 0, qui
 * s'afficherait « 30/12/1899 » au format date : la cellule reste donc vide tant
 * qu'aucune ligne n'a été vérifiée.
 */
function lastRunFormula_() {
  return '=IF(COUNT(' + asinRange_('D') + ')=0,"",MAX(' + asinRange_('D') + '))';
}

/**
 * Référence à une colonne entière de l'onglet « ASINs », en-tête exclu.
 * Le nom de l'onglet est toujours mis entre apostrophes : c'est valide quel que
 * soit le nom, et il vient d'une constante qui pourrait un jour contenir un
 * espace.
 */
function asinRange_(column) {
  return "'" + ASIN_SHEET_NAME + "'!" + column + ASIN_FIRST_DATA_ROW + ':' + column;
}
