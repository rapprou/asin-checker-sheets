/**
 * EditTrigger.gs — déclencheur simple onEdit : effacement des résultats périmés.
 *
 * Une ligne vérifiée dont l'utilisateur remplace l'ASIN en colonne A garderait
 * sinon son ancien statut — définitif, donc jamais réinterrogé : un statut faux
 * resterait affiché à côté du nouvel ASIN. Toute édition utilisateur de la
 * colonne A de l'onglet « ASINs » efface donc B:D sur les lignes touchées ; la
 * ligne redevient « à vérifier » (colonne B vide) et le mécanisme de reprise
 * existant fait le reste.
 *
 * Ce qui ne déclenche PAS onEdit, et c'est voulu :
 * - les écritures du script (setValues, clearContent) et les appels API —
 *   un run n'efface donc jamais ses propres résultats ;
 * - le tri (menu Données > Trier la plage, ou tri par filtre) : il part en
 *   onChange (changeType OTHER), jamais en onEdit — trier ne perd rien ;
 * - l'insertion ou la suppression de lignes entières (onChange aussi) : hors
 *   périmètre, comme toute modification faite par l'API Sheets.
 *
 * Annulation (Cmd+Z), constaté en réel : l'effacement du script entre dans la
 * pile d'annulation comme une étape à part. Un premier Cmd+Z restaure l'ASIN
 * (B:D encore vides), un second restaure aussi l'ancien résultat, en face du
 * bon ASIN — jamais de combinaison nouvel ASIN + ancien statut.
 */

/**
 * Déclencheur simple : tourne à chaque édition utilisateur du classeur, avec
 * une autorisation restreinte au classeur conteneur — ce qui suffit ici.
 * Doit rester rapide et silencieux : aucun verrou, aucun toast, aucune alerte.
 * Pas de verrou non plus face à un run en cours : l'effacement est la volonté
 * de l'utilisateur, et la course avec les écritures du run est fermée côté run
 * (voir freshResults_ dans AsinCheck.gs).
 */
function onEdit(e) {
  if (!e || !e.range) {
    return;
  }
  var range = e.range;
  var clear = staleResultsClearRange_({
    sheetName: range.getSheet().getName(),
    row: range.getRow(),
    column: range.getColumn(),
    numRows: range.getNumRows(),
    numColumns: range.getNumColumns(),
    value: e.value,
    oldValue: e.oldValue
  });
  if (!clear) {
    return;
  }
  range.getSheet()
      .getRange(clear.firstRow, ASIN_RESULT_FIRST_COLUMN, clear.numRows, ASIN_RESULT_WIDTH)
      .clearContent();
}

/**
 * Plage de résultats à effacer pour une édition donnée, ou null s'il n'y a
 * rien à faire. Fonction pure, testée hors Apps Script.
 *
 * @param {Object} edit { sheetName, row, column, numRows, numColumns,
 *     value, oldValue } — l'image de e.range et de l'événement.
 * @return {Object|null} { firstRow, numRows } en lignes de la feuille.
 */
function staleResultsClearRange_(edit) {
  if (edit.sheetName !== ASIN_SHEET_NAME) {
    return null;
  }
  // Une plage qui touche la colonne A commence forcément en colonne 1 : un
  // collage A:D est retenu, une édition limitée à B:D ne l'est pas.
  if (edit.column !== 1) {
    return null;
  }

  // Valeur inchangée : le résultat reste valable, rien à effacer. Comparaison
  // normalisée — passer « b07x » en « B07X » interroge le même ASIN. oldValue
  // n'est fourni que pour une édition mono-cellule ; absent (collage,
  // suppression au clavier), on efface par prudence, comme demandé.
  if (edit.numRows === 1 && edit.numColumns === 1 &&
      edit.value !== undefined && edit.oldValue !== undefined &&
      normalizeAsin_(edit.value) === normalizeAsin_(edit.oldValue)) {
    return null;
  }

  // La ligne d'en-têtes ne porte jamais de résultat : une plage qui la couvre
  // est tronquée, une édition qui ne couvre qu'elle est ignorée.
  var firstRow = Math.max(edit.row, ASIN_FIRST_DATA_ROW);
  var lastRow = edit.row + edit.numRows - 1;
  if (lastRow < firstRow) {
    return null;
  }
  return { firstRow: firstRow, numRows: lastRow - firstRow + 1 };
}
