/**
 * ConnectionTest.gs — entrée de menu « Test connection ».
 *
 * Vérifie d'abord la configuration via validateSettings_() (Validation.gs),
 * puis tente l'échange de jeton LWA. Le résultat est écrit dans l'onglet
 * « Settings » ; aucun message ne contient de secret.
 *
 * L'appel se fait volontairement sans le cache de jeton : tester la connexion
 * doit réellement interroger Amazon. Le jeton retourné est ignoré.
 */

var TEST_SUCCESS_MESSAGE =
    'LWA connection successful: an access token was obtained with the saved keys.';
var TEST_INCOMPLETE_PREFIX = 'Configuration incomplete: ';
var TEST_TOAST_MESSAGE = 'Test complete — see the Settings tab.';

function testConnection() {
  ensureSettingsSheet_();
  refreshKeyStatuses_();

  var problems = validateSettings_();
  if (problems.length > 0) {
    // Configuration incomplète : inutile d'appeler Amazon.
    writeTestResult_(false, TEST_INCOMPLETE_PREFIX + problems.join('; ') + '.');
    showToast_(TEST_TOAST_MESSAGE);
    return;
  }

  var result = requestAccessToken_(getCredentials_());
  writeTestResult_(result.ok, result.ok ? TEST_SUCCESS_MESSAGE : lwaErrorMessage_(result));
  showToast_(TEST_TOAST_MESSAGE);
}
