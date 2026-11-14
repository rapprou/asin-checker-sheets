/**
 * Summary.gs — onglet « Summary ».
 *
 * L'onglet ne contient que des formules : le script n'y écrit aucun compte.
 * Conséquence voulue — les chiffres suivent l'onglet « ASINs » en direct, même
 * quand le client efface une cellule à la main, et un onglet « Summary » jamais
 * régénéré reste juste.
 *
 * Les noms de fonctions sont écrits en anglais (COUNTIFS, COUNTA, MAX…), ce que
 * Sheets accepte dans toutes les locales. Le **séparateur d'arguments**, lui,
 * suit la locale du classeur : un Sheet français attend « ; » et renvoie
 * #ERROR! sur une formule à virgules. setFormula() ne traduit rien.
 * Il est donc détecté à l'exécution par detectFormulaSeparator_() et passé aux
 * constructeurs de formules, qui restent purs.
 *
 * Les lignes de statuts sont générées depuis statusList_() (Statuses.gs) et
 * colorées par statusStyle_() : aucun statut ni aucune couleur en dur ici.
 */

var SUMMARY_SHEET_NAME = 'Summary';

/**
 * Nom porté par cet onglet avant le passage de l'interface en anglais.
 * Voir findSheetWithLegacyName_ (Config.gs) : il est renommé en place.
 */
var LEGACY_SUMMARY_SHEET_NAME = 'Récap';

var SUMMARY_TITLE = 'ASIN Checker — Summary';
var SUMMARY_TITLE_CELL = 'A1';

var SUMMARY_HEADERS = ['Status', 'Count', '%'];
var SUMMARY_WIDTH = 3;

/** Ligne d'en-têtes du tableau, puis première ligne de statut. */
var SUMMARY_HEADER_ROW = 3;
var SUMMARY_FIRST_STATUS_ROW = 4;

var SUMMARY_COUNT_COLUMN = 'B';
var SUMMARY_SHARE_FORMAT = '0.0%';

var SUMMARY_TOTAL_LABEL = 'Total ASINs';
var SUMMARY_PENDING_LABEL = 'Remaining';
var SUMMARY_LAST_RUN_LABEL = 'Last run';

var SUMMARY_DONE_MESSAGE = 'Summary tab up to date.';

/**
 * Séparateurs d'arguments possibles, dans l'ordre d'essai de la sonde.
 * Aucune locale n'en accepte un troisième.
 */
var FORMULA_SEPARATORS = [',', ';'];

/**
 * Sonde de détection : deux arguments, aucun littéral traduit par Sheets
 * (« TRUE » devient VRAI dans certaines locales), et un résultat numérique
 * sans ambiguïté. Une formule au mauvais séparateur ne rend pas 2 mais une
 * erreur d'analyse.
 */
var SEPARATOR_PROBE_EXPECTED = 2;

/** Colonne de la cellule sonde : hors du tableau (A:C), vidée aussitôt après. */
var SEPARATOR_PROBE_COLUMN = SUMMARY_WIDTH + 2;
var SEPARATOR_PROBE_ROW = 1;

var SEPARATOR_DETECTION_FAILED_MESSAGE =
    'Could not determine the formula argument separator for this spreadsheet: ' +
    'neither "," nor ";" was accepted. The Summary tab was not modified — ' +
    'report this message to support.';

/** Entrée de menu « Create / repair Summary ». */
function ensureSummarySheet() {
  buildSummaryLayout_(getSummarySheet_());
  showToast_(SUMMARY_DONE_MESSAGE);
}

function getSummarySheet_() {
  var spreadsheet = SpreadsheetApp.getActive();
  return findSheetWithLegacyName_(
          spreadsheet, SUMMARY_SHEET_NAME, LEGACY_SUMMARY_SHEET_NAME) ||
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
  // Le séparateur est détecté une seule fois par passage, et avant le clear() :
  // si la détection échoue, elle lève, et l'onglet « Summary » existant reste
  // intact plutôt que d'être remplacé par une grille de #ERROR!.
  var plan = summaryPlan_(detectFormulaSeparator_(sheet));

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
 * Séparateur d'arguments attendu par ce classeur.
 *
 * Il n'existe aucune API pour le lire : Spreadsheet.getSpreadsheetLocale()
 * renvoie la locale, mais la correspondance locale → séparateur n'est
 * documentée nulle part et changerait sous nos pieds. On le constate donc, en
 * faisant évaluer une formule sonde par Sheets lui-même.
 *
 * La cellule sonde est hors du tableau et vidée dans un finally : une
 * exception en cours de détection ne laisse pas de formule orpheline.
 *
 * @return {string} ',' ou ';'
 * @throws {Error} Si aucun séparateur n'est accepté — mieux vaut échouer
 *     bruyamment que remplir l'onglet « Summary » de #ERROR! en silence.
 */
function detectFormulaSeparator_(sheet) {
  var probe = sheet.getRange(SEPARATOR_PROBE_ROW, SEPARATOR_PROBE_COLUMN);
  try {
    for (var i = 0; i < FORMULA_SEPARATORS.length; i++) {
      probe.setFormula(separatorProbeFormula_(FORMULA_SEPARATORS[i]));
      // Sans flush(), la formule n'est pas encore évaluée et getValue() rendrait
      // l'ancienne valeur de la cellule.
      SpreadsheetApp.flush();
      // Sur erreur d'analyse, getValue() rend le texte de l'erreur, jamais 2.
      if (probe.getValue() === SEPARATOR_PROBE_EXPECTED) {
        return FORMULA_SEPARATORS[i];
      }
    }
  } finally {
    probe.clearContent();
  }
  throw new Error(SEPARATOR_DETECTION_FAILED_MESSAGE);
}

function separatorProbeFormula_(separator) {
  return '=SUM(1' + separator + '1)';
}

/**
 * Plan de l'onglet : quelle formule dans quelle cellule. Fonction pure, donc
 * testable hors Apps Script — c'est là que vivent toutes les formules.
 *
 * @param {string} separator Séparateur d'arguments de ce classeur, rendu par
 *     detectFormulaSeparator_().
 * @return {Object} { statusLines, totalLines, lastRunRow }
 */
function summaryPlan_(separator) {
  var statuses = statusList_();
  var totalRow = SUMMARY_FIRST_STATUS_ROW + statuses.length + 1;
  var totalCell = '$' + SUMMARY_COUNT_COLUMN + '$' + totalRow;

  var statusLines = statuses.map(function (status, index) {
    var row = SUMMARY_FIRST_STATUS_ROW + index;
    return {
      row: row,
      status: status,
      countFormula: statusCountFormula_(status, separator),
      // Protection contre la division par zéro : un classeur vide affiche 0 %
      // et non #DIV/0!.
      shareFormula: '=IFERROR(' + SUMMARY_COUNT_COLUMN + row + '/' + totalCell +
          separator + '0)'
    };
  });

  return {
    statusLines: statusLines,
    totalLines: [
      { row: totalRow, label: SUMMARY_TOTAL_LABEL, formula: totalFormula_() },
      {
        row: totalRow + 1,
        label: SUMMARY_PENDING_LABEL,
        formula: pendingFormula_(totalCell, statusLines, separator)
      },
      {
        row: totalRow + 2,
        label: SUMMARY_LAST_RUN_LABEL,
        formula: lastRunFormula_(separator)
      }
    ],
    lastRunRow: totalRow + 2
  };
}

/** Lignes portant un ASIN et ce statut exact. */
function statusCountFormula_(status, separator) {
  return '=COUNTIFS(' + asinRange_('A') + separator + '"<>"' + separator +
      asinRange_('B') + separator + '"' + status + '")';
}

/**
 * Volontairement sans paramètre : COUNTA n'a qu'un argument, donc pas de
 * séparateur. C'est aussi la seule formule de l'onglet « Summary » qui
 * fonctionnait avant la détection du séparateur. Lui en ajouter un deuxième =
 * lui passer `separator`.
 */
function totalFormula_() {
  return '=COUNTA(' + asinRange_('A') + ')';
}

/**
 * « Remaining » = total − somme des statuts définitifs.
 *
 * Compté par soustraction, et non en additionnant les lignes vides et les
 * ERROR : c'est la définition exacte de ce que le prochain run reprendra
 * (isPendingStatus_), y compris une colonne B vide, que COUNTIFS ne sait pas
 * distinguer d'une ligne sans ASIN. Les statuts définitifs sont ceux que
 * isPendingStatus_ refuse — ERROR n'en fait donc pas partie et reste compté
 * comme à traiter.
 */
function pendingFormula_(totalCell, statusLines, separator) {
  var definitive = statusLines.filter(function (line) {
    return !isPendingStatus_(line.status);
  });
  return '=' + totalCell + '-SUM(' + definitive.map(function (line) {
    return SUMMARY_COUNT_COLUMN + line.row;
  }).join(separator) + ')';
}

/**
 * Date du dernier ASIN vérifié. MAX() sur une colonne vide renvoie 0, qui
 * s'afficherait « 30/12/1899 » au format date : la cellule reste donc vide tant
 * qu'aucune ligne n'a été vérifiée.
 */
function lastRunFormula_(separator) {
  return '=IF(COUNT(' + asinRange_('D') + ')=0' + separator + '""' + separator +
      'MAX(' + asinRange_('D') + '))';
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
