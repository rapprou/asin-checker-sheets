/**
 * ConnectionTest.gs — entrée de menu « Tester la connexion ».
 *
 * Vérifie d'abord la configuration (clés présentes, Seller ID, marketplace),
 * puis tente l'échange de jeton LWA. Le résultat est écrit dans l'onglet
 * « Paramètres » ; aucun message ne contient de secret.
 */

var TEST_SUCCESS_MESSAGE =
    "Connexion LWA réussie : un jeton d'accès a été obtenu avec les clés enregistrées.";
var TEST_INCOMPLETE_PREFIX = 'Configuration incomplète : ';
var TEST_TOAST_MESSAGE = 'Test terminé — voir l\'onglet « Paramètres ».';

function testConnection() {
  ensureSettingsSheet();
  refreshKeyStatuses_();

  var problems = validateSettings_();
  if (problems.length > 0) {
    // Configuration incomplète : inutile d'appeler Amazon.
    writeTestResult_(false, TEST_INCOMPLETE_PREFIX + problems.join(' ; ') + '.');
    showToast_(TEST_TOAST_MESSAGE);
    return;
  }

  var result = requestAccessToken_(getCredentials_());
  writeTestResult_(result.ok, result.ok ? TEST_SUCCESS_MESSAGE : lwaErrorMessage_(result));
  showToast_(TEST_TOAST_MESSAGE);
}

/** Problèmes de configuration bloquants, formulés pour l'utilisateur final. */
function validateSettings_() {
  var problems = [];

  var missingKeys = missingKeyLabels_();
  if (missingKeys.length > 0) {
    problems.push('clé(s) manquante(s) : ' + missingKeys.join(', ') +
        ' (menu « ASIN Checker » → « Saisir / modifier les clés »)');
  }
  if (!readSellerId_()) {
    problems.push('Seller ID non renseigné (cellule ' + CELLS.sellerId + ')');
  }
  if (!readMarketplace_()) {
    problems.push('marketplace non renseignée ou hors liste (cellule ' + CELLS.marketplace + ')');
  }
  return problems;
}
