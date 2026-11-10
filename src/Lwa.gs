/**
 * Lwa.gs — obtention d'un jeton d'accès Login With Amazon.
 *
 * Le jeton est retourné pour usage interne (appels SP-API) et mis en cache le
 * temps d'un run. Il ne doit jamais atteindre une cellule, un log, un toast ni
 * un message d'erreur. Du corps de réponse on n'extrait que deux champs :
 * « access_token » en cas de succès, « error » en cas d'échec — et ce dernier
 * n'est affiché qu'à travers l'allowlist LWA_ERROR_MESSAGES.
 */

var LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
var LWA_GRANT_TYPE = 'refresh_token';

/** Cache du jeton : 50 min, en deçà de sa validité réelle (1 h). */
var TOKEN_CACHE_KEY = 'LWA_ACCESS_TOKEN';
var TOKEN_CACHE_SECONDS = 3000;

var LWA_HTTP_OK = 200;

/** Le corps renvoie 200 mais sans jeton exploitable : traité comme un échec. */
var LWA_MISSING_TOKEN_CODE = 'missing_access_token';

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
 * Échange le refresh_token contre un jeton d'accès, sans cache.
 * @param {Object} credentials clientId, clientSecret, refreshToken.
 * @return {Object} { ok, httpCode, errorCode, accessToken } — accessToken est
 *     vide hors succès, et reste à usage interne strict.
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
    return { ok: false, httpCode: LWA_NETWORK_ERROR_CODE, errorCode: '', accessToken: '' };
  }

  var httpCode = response.getResponseCode();
  if (httpCode === LWA_HTTP_OK) {
    // Du corps on n'extrait que le jeton lui-même.
    var accessToken = extractAccessToken_(response.getContentText());
    return {
      ok: Boolean(accessToken),
      httpCode: httpCode,
      errorCode: accessToken ? '' : LWA_MISSING_TOKEN_CODE,
      accessToken: accessToken
    };
  }
  return {
    ok: false,
    httpCode: httpCode,
    errorCode: extractErrorCode_(response.getContentText()),
    accessToken: ''
  };
}

/**
 * Jeton d'accès pour un run, mis en cache : un seul échange LWA quelle que soit
 * la taille du run, et une relance rapprochée le réutilise.
 *
 * Usage interne strict — le jeton ne doit jamais sortir vers la feuille, un log,
 * un toast ou un message d'erreur.
 *
 * @return {Object} Même forme que requestAccessToken_.
 */
function getAccessToken_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(TOKEN_CACHE_KEY);
  if (cached) {
    return { ok: true, httpCode: LWA_HTTP_OK, errorCode: '', accessToken: cached };
  }

  var result = requestAccessToken_(getCredentials_());
  if (result.ok) {
    cache.put(TOKEN_CACHE_KEY, result.accessToken, TOKEN_CACHE_SECONDS);
  }
  return result;
}

/**
 * Purge le jeton en cache. À appeler dès que les clés changent ou disparaissent :
 * sinon un jeton obtenu avec les anciennes clés resterait utilisable jusqu'à 50 min.
 */
function clearCachedToken_() {
  CacheService.getScriptCache().remove(TOKEN_CACHE_KEY);
}

/** Extrait le seul champ « access_token » du corps de succès. */
function extractAccessToken_(body) {
  try {
    var parsed = JSON.parse(body);
    return typeof parsed.access_token === 'string' ? parsed.access_token : '';
  } catch (error) {
    return '';
  }
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
