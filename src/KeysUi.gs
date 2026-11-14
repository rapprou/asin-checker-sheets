/**
 * KeysUi.gs — ouverture du dialogue de saisie des clés.
 *
 * Le gabarit ne reçoit que des booléens de présence : aucune valeur de clé
 * n'est envoyée au navigateur, donc les champs du formulaire sont toujours vides.
 *
 * Ce fichier ne peut pas s'appeler KeysDialog.gs : Apps Script identifie les
 * fichiers par leur nom sans extension, et KeysDialog est déjà pris par le
 * gabarit KeysDialog.html.
 */

var DIALOG_TEMPLATE_NAME = 'KeysDialog';
var DIALOG_TITLE = 'SP-API keys';
var DIALOG_WIDTH = 470;
var DIALOG_HEIGHT = 500;

/** Entrée de menu « Enter / edit keys ». */
function showKeysDialog() {
  ensureSettingsSheet_();
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
