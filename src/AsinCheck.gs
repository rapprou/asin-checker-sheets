/**
 * AsinCheck.gs — entrée de menu « Vérifier les ASINs ».
 *
 * Un run traite les lignes dont la colonne B est vide ou vaut ERROR, à
 * ~4 requêtes/seconde, et s'arrête de lui-même avant la limite d'exécution
 * d'Apps Script. Les résultats sont écrits dans un finally : une interruption ne
 * perd rien, et relancer le menu reprend là où ça s'est arrêté.
 *
 * Un 400/401/403 arrête le run au lieu d'écrire un statut partout : la cause est
 * globale (Seller ID, marketplace, jeton, droits de l'application), pas propre à
 * un ASIN.
 */

/**
 * Budget de boucle : 4 min 30. Laisse ~30 s pour le dernier ASIN (jusqu'à 15 s
 * de backoff) et l'écriture finale, sous la limite de 6 min d'Apps Script.
 */
var MAX_RUN_MILLIS = 270000;

/** ~4 requêtes/seconde, quota SP-API « restrictions ». */
var REQUEST_INTERVAL_MILLIS = 250;

var RUN_TOAST_SECONDS = 10;

var RUN_CONFIG_TITLE = 'Vérification impossible';
var RUN_CONFIG_PREFIX = 'Configuration incomplète : ';
var RUN_AUTH_TITLE = 'Authentification Amazon';
var RUN_STOPPED_TITLE = 'Vérification interrompue';
var RUN_NOTHING_TO_DO_MESSAGE =
    "Aucun ASIN à vérifier : la colonne A est vide, ou toutes les lignes ont déjà un statut " +
    'définitif.';

/** Messages d'arrêt par code HTTP. Allowlist : aucun corps de réponse n'est affiché. */
var RUN_FATAL_MESSAGES = {
  400: 'Requête refusée par Amazon (HTTP 400).\n\nVérifiez le Seller ID et la marketplace ' +
      "dans l'onglet « Paramètres ». Le format des ASINs est déjà contrôlé avant l'appel, " +
      "donc ce refus ne vient pas d'eux.",
  401: 'Jeton refusé par Amazon (HTTP 401).\n\nVérifiez les clés SP-API via ' +
      '« Saisir / modifier les clés », puis « Tester la connexion ».',
  403: "Accès refusé par Amazon (HTTP 403).\n\nVérifiez le Seller ID de l'onglet " +
      "« Paramètres » et les droits (rôles) accordés à votre application SP-API."
};

var RUN_FATAL_SUFFIX =
    '\n\nLes ASINs déjà vérifiés ont été enregistrés. Les autres lignes sont inchangées et ' +
    'seront reprises à la prochaine exécution.';

function checkAsins() {
  var sheet = ensureAsinsSheet_();
  var ui = SpreadsheetApp.getUi();

  var problems = validateSettings_();
  if (problems.length > 0) {
    // Configuration incomplète : aucun appel réseau.
    ui.alert(RUN_CONFIG_TITLE, RUN_CONFIG_PREFIX + problems.join(' ; ') + '.', ui.ButtonSet.OK);
    return;
  }

  var pending = readPendingRows_(sheet);
  if (pending.length === 0) {
    showToast_(RUN_NOTHING_TO_DO_MESSAGE);
    return;
  }

  var token = getAccessToken_();
  if (!token.ok) {
    // lwaErrorMessage_ passe par une allowlist : aucun secret, aucun corps de réponse.
    ui.alert(RUN_AUTH_TITLE, lwaErrorMessage_(token), ui.ButtonSet.OK);
    return;
  }

  var fatal = runChecks_(sheet, pending, buildContext_(token));
  if (fatal) {
    ui.alert(RUN_STOPPED_TITLE, fatalMessage_(fatal), ui.ButtonSet.OK);
  }
}

/**
 * Contexte partagé par toutes les requêtes du run. Il porte le jeton d'accès :
 * ne jamais l'écrire dans une cellule, un log ou un message.
 */
function buildContext_(token) {
  return {
    accessToken: token.accessToken,
    sellerId: readSellerId_(),
    marketplaceId: readMarketplace_().marketplaceId
  };
}

/**
 * Boucle de vérification.
 * @return {Object} La cause d'arrêt ({ fatal, httpCode }), ou null.
 */
function runChecks_(sheet, pending, context) {
  var results = [];
  var state = { tokenRefreshed: false, fatal: null };
  var startedAt = Date.now();

  try {
    for (var i = 0; i < pending.length; i++) {
      if (Date.now() - startedAt > MAX_RUN_MILLIS) {
        // Budget épuisé : le reste sera traité à la prochaine exécution.
        break;
      }
      if (i > 0) {
        Utilities.sleep(REQUEST_INTERVAL_MILLIS);
      }

      var outcome = checkAsinWithRefresh_(pending[i].asin, context, state);
      if (outcome.fatal) {
        // Arrêt immédiat, sans résultat pour cette ligne : elle et les suivantes
        // gardent leur colonne B, donc le prochain run les reprendra.
        clearCachedToken_();
        state.fatal = outcome;
        break;
      }

      results.push({
        row: pending[i].row,
        status: outcome.status,
        code: outcome.code,
        checkedAt: new Date(),
        isRetry: pending[i].isRetry
      });
    }
  } finally {
    writeResults_(sheet, results);
    reportRun_(results, pending);
  }

  return state.fatal;
}

/**
 * Vérifie un ASIN, avec un unique renouvellement de jeton sur 401.
 *
 * Le drapeau est porté par le run et non par l'ASIN : une fois le jeton
 * renouvelé, un nouveau 401 signifie que les clés sont réellement refusées, et
 * réessayer ne ferait que retarder l'arrêt.
 */
function checkAsinWithRefresh_(asin, context, state) {
  var outcome = checkAsin_(asin, context);
  if (!outcome.fatal || outcome.httpCode !== HTTP_UNAUTHORIZED || state.tokenRefreshed) {
    return outcome;
  }

  // Le jeton en cache a peut-être simplement expiré : on en réclame un neuf.
  state.tokenRefreshed = true;
  clearCachedToken_();
  var token = getAccessToken_();
  if (!token.ok) {
    return outcome;
  }
  context.accessToken = token.accessToken;
  return checkAsin_(asin, context);
}

/** Message d'arrêt affiché à l'utilisateur. Jamais de corps de réponse. */
function fatalMessage_(fatal) {
  var message = RUN_FATAL_MESSAGES[fatal.httpCode] ||
      'Amazon a refusé la requête (HTTP ' + fatal.httpCode + ').';
  return message + RUN_FATAL_SUFFIX;
}

/** Bilan du run : distingue les nouvelles lignes des ERROR relancées. */
function reportRun_(results, pending) {
  var retried = countRetries_(results);
  var message = results.length + ' ASIN(s) vérifié(s)';
  if (retried > 0) {
    message += ' : ' + (results.length - retried) + ' nouveau(x), ' + retried +
        ' relancé(s) après ERROR';
  }
  message += '.';

  var remaining = pending.length - results.length;
  if (remaining > 0) {
    message += ' ' + remaining + ' restant(s) — relancez « Vérifier les ASINs » pour continuer.';
  }
  showToast_(message, RUN_TOAST_SECONDS);
}

function countRetries_(results) {
  return results.filter(function (result) {
    return result.isRetry;
  }).length;
}
