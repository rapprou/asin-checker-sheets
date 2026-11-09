/**
 * Lwa.gs — obtention d'un jeton d'accès Login With Amazon.
 *
 * Le jeton n'est volontairement pas retourné : l'étape 1 n'a besoin que de
 * savoir si l'échange réussit. Moins le jeton circule, moins il peut fuiter.
 * (L'étape 2, qui appellera SP-API, étendra ce retour.)
 *
 * Du corps de réponse, seul le champ « error » est extrait, et il n'est affiché
 * qu'à travers l'allowlist LWA_ERROR_MESSAGES.
 */

var LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
var LWA_GRANT_TYPE = 'refresh_token';

/** Code d'erreur LWA → message utilisateur en français. */
var LWA_ERROR_MESSAGES = {
  invalid_grant: 'refresh_token invalide, révoqué ou expiré : générez-en un nouveau puis ressaisissez-le.',
  invalid_client: 'client_id ou client_secret invalide.',
  unauthorized_client: "L'application LWA n'est pas autorisée à utiliser ce refresh_token.",
  invalid_request: 'Requête de jeton mal formée : vérifiez que les trois clés ont été saisies sans espace parasite.',
  invalid_scope: 'Scope LWA invalide pour cette application.'
};

var LWA_NETWORK_ERROR_MESSAGE =
    'Impossible de joindre api.amazon.com : réseau indisponible ou quota UrlFetch atteint.';

/** httpCode = 0 signale un échec réseau, avant toute réponse HTTP. */
var LWA_NETWORK_ERROR_CODE = 0;

/**
 * Échange le refresh_token contre un jeton d'accès.
 * @param {Object} credentials clientId, clientSecret, refreshToken.
 * @return {Object} { ok: boolean, httpCode: number, errorCode: string }
 */
function requestAccessToken_(credentials) {
  var options = {
    method: 'post',
    payload: {
      grant_type: LWA_GRANT_TYPE,
      refresh_token: credentials.refreshToken,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret
    },
    muteHttpExceptions: true
  };

  var response;
  try {
    response = UrlFetchApp.fetch(LWA_TOKEN_URL, options);
  } catch (error) {
    // Le texte de l'exception n'est pas repris : seul un message générique remonte.
    return { ok: false, httpCode: LWA_NETWORK_ERROR_CODE, errorCode: '' };
  }

  var httpCode = response.getResponseCode();
  if (httpCode === 200) {
    // Succès : le corps contient le jeton, on ne le lit pas.
    return { ok: true, httpCode: httpCode, errorCode: '' };
  }
  return {
    ok: false,
    httpCode: httpCode,
    errorCode: extractErrorCode_(response.getContentText())
  };
}

/** Message utilisateur correspondant à un échec. Ne contient jamais de secret. */
function lwaErrorMessage_(result) {
  if (result.httpCode === LWA_NETWORK_ERROR_CODE) {
    return LWA_NETWORK_ERROR_MESSAGE;
  }
  if (LWA_ERROR_MESSAGES[result.errorCode]) {
    return LWA_ERROR_MESSAGES[result.errorCode];
  }
  return "Échec de l'authentification Amazon (HTTP " + result.httpCode +
      (result.errorCode ? ', ' + result.errorCode : '') + ').';
}

/** Extrait le seul champ « error » du corps d'erreur LWA. */
function extractErrorCode_(body) {
  try {
    var parsed = JSON.parse(body);
    return typeof parsed.error === 'string' ? parsed.error : '';
  } catch (error) {
    return '';
  }
}
