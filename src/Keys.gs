/**
 * Keys.gs — seul fichier autorisé à lire ou écrire les clés SP-API.
 *
 * Règles non négociables :
 *  - les valeurs ne vivent que dans les propriétés du script (PropertiesService) ;
 *  - aucune valeur n'est écrite dans une cellule, un log, un toast ou un message
 *    d'erreur ;
 *  - aucune fonction globale (donc appelable depuis le HTML) ne retourne une
 *    valeur de clé : getKeyStatuses() ne renvoie que des booléens de présence.
 */

var PROP_CLIENT_ID = 'SPAPI_CLIENT_ID';
var PROP_CLIENT_SECRET = 'SPAPI_CLIENT_SECRET';
var PROP_REFRESH_TOKEN = 'SPAPI_REFRESH_TOKEN';

/** Champ du dialogue → propriété de script → libellé affiché à l'utilisateur. */
var KEY_FIELDS = [
  { field: 'clientId', property: PROP_CLIENT_ID, label: 'client_id' },
  { field: 'clientSecret', property: PROP_CLIENT_SECRET, label: 'client_secret' },
  { field: 'refreshToken', property: PROP_REFRESH_TOKEN, label: 'refresh_token' }
];

var CLEAR_DIALOG_TITLE = 'Clear keys';
var CLEAR_DIALOG_QUESTION =
    'The three SP-API keys (client_id, client_secret, refresh_token) will be ' +
    'deleted from the script properties.\n\n' +
    'The seller name, the Seller ID and the marketplace on the Settings tab are ' +
    'not modified.\n\n' +
    'Continue?';
var CLEAR_DONE_MESSAGE = 'Keys cleared: enter them again before running a test.';
var CLEAR_CANCELLED_MESSAGE = 'Canceled: keys are unchanged.';

/**
 * Enregistre les clés soumises par le dialogue.
 * Un champ laissé vide signifie « clé inchangée ».
 * Appelée depuis KeysDialog.html via google.script.run.
 *
 * @param {Object} payload Champs clientId, clientSecret, refreshToken.
 * @return {Object} Statuts de présence uniquement, jamais de valeur.
 */
function saveKeys(payload) {
  var updates = {};
  KEY_FIELDS.forEach(function (key) {
    var value = readSubmittedValue_(payload, key.field);
    if (value) {
      updates[key.property] = value;
    }
  });
  if (Object.keys(updates).length > 0) {
    PropertiesService.getScriptProperties().setProperties(updates, false);
    // Le jeton en cache a été obtenu avec les clés précédentes.
    clearCachedToken_();
  }
  refreshKeyStatuses_();
  return getKeyStatuses();
}

/**
 * Présence de chaque clé.
 * @return {Object} { clientId: boolean, clientSecret: boolean, refreshToken: boolean }
 */
function getKeyStatuses() {
  var stored = PropertiesService.getScriptProperties();
  var statuses = {};
  KEY_FIELDS.forEach(function (key) {
    // Seule la présence est conservée : la valeur lue n'est pas retournée.
    statuses[key.field] = Boolean(stored.getProperty(key.property));
  });
  return statuses;
}

/** Recopie les statuts dans l'onglet « Settings ». */
function refreshKeyStatuses_() {
  writeKeyStatuses_(getKeyStatuses());
}

/**
 * Entrée de menu « Clear keys ».
 * Demande confirmation, puis supprime les trois clés SP-API et rien d'autre.
 */
function clearKeys() {
  ensureSettingsSheet_();
  refreshKeyStatuses_();

  var ui = SpreadsheetApp.getUi();
  var response = ui.alert(CLEAR_DIALOG_TITLE, CLEAR_DIALOG_QUESTION, ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) {
    showToast_(CLEAR_CANCELLED_MESSAGE);
    return;
  }

  deleteStoredKeys_();
  clearCachedToken_();
  refreshKeyStatuses_();
  clearTestResult_();
  showToast_(CLEAR_DONE_MESSAGE);
}

/**
 * Supprime les trois propriétés SP-API, et uniquement celles-là.
 * Volontairement pas deleteAllProperties() : les autres propriétés du script
 * (actuelles ou ajoutées plus tard) ne doivent pas être touchées.
 */
function deleteStoredKeys_() {
  var stored = PropertiesService.getScriptProperties();
  KEY_FIELDS.forEach(function (key) {
    stored.deleteProperty(key.property);
  });
}

/** Libellés des clés absentes, pour les messages de configuration incomplète. */
function missingKeyLabels_() {
  var statuses = getKeyStatuses();
  return KEY_FIELDS
      .filter(function (key) { return !statuses[key.field]; })
      .map(function (key) { return key.label; });
}

/**
 * Valeurs des clés. Privée : réservée à l'appel du jeton LWA.
 * Ne jamais exposer ce retour à l'interface ni le journaliser.
 */
function getCredentials_() {
  var stored = PropertiesService.getScriptProperties();
  return {
    clientId: stored.getProperty(PROP_CLIENT_ID) || '',
    clientSecret: stored.getProperty(PROP_CLIENT_SECRET) || '',
    refreshToken: stored.getProperty(PROP_REFRESH_TOKEN) || ''
  };
}

function readSubmittedValue_(payload, field) {
  var raw = payload ? payload[field] : '';
  return typeof raw === 'string' ? raw.trim() : '';
}
