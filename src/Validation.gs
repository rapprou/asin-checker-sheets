/**
 * Validation.gs — la configuration est-elle complète ?
 *
 * Extraite de ConnectionTest.gs à l'étape 2 : le test de connexion et le run de
 * vérification des ASINs ont tous deux besoin de ce contrôle, et le run ne doit
 * pas dépendre du fichier de test.
 */

/**
 * Problèmes de configuration bloquants, formulés pour l'utilisateur final.
 * Ne cite que des noms de clés, jamais une valeur.
 * @return {Array<string>} Vide si la configuration est complète.
 */
function validateSettings_() {
  var problems = [];

  var missingKeys = missingKeyLabels_();
  if (missingKeys.length > 0) {
    problems.push('missing keys: ' + missingKeys.join(', ') +
        ' (menu "ASIN Checker" → "Enter / edit keys")');
  }
  if (!readSellerId_()) {
    problems.push('Seller ID is empty (Settings tab, cell ' + CELLS.sellerId + ')');
  }
  if (!readMarketplace_()) {
    problems.push('marketplace is empty or not in the list (Settings tab, cell ' +
        CELLS.marketplace + ')');
  }
  return problems;
}
