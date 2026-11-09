/**
 * KeysDialog.gs — ouverture du dialogue de saisie des clés.
 *
 * Le gabarit ne reçoit que des booléens de présence : aucune valeur de clé
 * n'est envoyée au navigateur, donc les champs du formulaire sont toujours vides.
 */

var DIALOG_TEMPLATE_NAME = 'KeysDialog';
var DIALOG_TITLE = 'Clés SP-API';
var DIALOG_WIDTH = 470;
var DIALOG_HEIGHT = 500;

/** Entrée de menu « Saisir / modifier les clés ». */
function showKeysDialog() {
  ensureSettingsSheet();
  refreshKeyStatuses_();
  SpreadsheetApp.getUi().showModalDialog(buildKeysDialog_(), DIALOG_TITLE);
}

function buildKeysDialog_() {
  var template = HtmlService.createTemplateFromFile(DIALOG_TEMPLATE_NAME);
  template.statuses = getKeyStatuses();
  return template.evaluate()
      .setWidth(DIALOG_WIDTH)
      .setHeight(DIALOG_HEIGHT);
}
