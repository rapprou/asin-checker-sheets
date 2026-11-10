/**
 * Restrictions.gs — appel SP-API « listings restrictions » et classification.
 *
 * Pas de signature AWS SigV4 : SP-API ne l'exige plus, le jeton LWA porté par
 * l'en-tête x-amz-access-token suffit. Ce jeton ne doit jamais sortir d'ici
 * autrement que dans l'en-tête de la requête.
 *
 * Aucun corps de réponse d'erreur n'est lu ni affiché : seul le code HTTP
 * remonte jusqu'à la feuille.
 */

var SPAPI_HOST = 'https://sellingpartnerapi-eu.amazon.com';
var RESTRICTIONS_PATH = '/listings/2021-08-01/restrictions';
var ACCESS_TOKEN_HEADER = 'x-amz-access-token';

/** Seule condition qui nous intéresse ; les used_* sont écartées. */
var CONDITION_TYPE_NEW = 'new';

/** Paliers d'attente après un 429, en millisecondes. */
var BACKOFF_MILLIS = [1000, 2000, 4000, 8000];

var HTTP_OK = 200;
var HTTP_BAD_REQUEST = 400;
var HTTP_UNAUTHORIZED = 401;
var HTTP_FORBIDDEN = 403;
var HTTP_NOT_FOUND = 404;
var HTTP_TOO_MANY_REQUESTS = 429;

/** httpCode = 0 signale un échec réseau, avant toute réponse HTTP. */
var SPAPI_NETWORK_ERROR_CODE = 0;
var SPAPI_NETWORK_ERROR_LABEL = 'RÉSEAU';
var SPAPI_UNREADABLE_LABEL = 'RÉPONSE ILLISIBLE';

/**
 * Vérifie un ASIN, avec backoff exponentiel sur 429.
 * @param {string} asin ASIN normalisé.
 * @param {Object} context accessToken, sellerId, marketplaceId. Le jeton qu'il
 *     porte ne doit jamais être écrit dans une cellule, un log ou un message.
 * @return {Object} { status, code }
 */
function checkAsin_(asin, context) {
  for (var attempt = 0; attempt <= BACKOFF_MILLIS.length; attempt++) {
    var response = fetchRestrictions_(asin, context);
    if (response.httpCode !== HTTP_TOO_MANY_REQUESTS) {
      return toOutcome_(response);
    }
    if (attempt < BACKOFF_MILLIS.length) {
      Utilities.sleep(BACKOFF_MILLIS[attempt]);
    }
  }
  // Tous les paliers de backoff épuisés : on rend la main sur une erreur de quota.
  return { status: ASIN_STATUS.error, code: 'HTTP ' + HTTP_TOO_MANY_REQUESTS };
}

/** Un appel, sans retry. @return {Object} { httpCode, payload } */
function fetchRestrictions_(asin, context) {
  var headers = {};
  headers[ACCESS_TOKEN_HEADER] = context.accessToken;
  var options = {
    method: 'get',
    headers: headers,
    muteHttpExceptions: true
  };

  var response;
  try {
    response = UrlFetchApp.fetch(restrictionsUrl_(asin, context), options);
  } catch (error) {
    // Le texte de l'exception n'est pas repris : seul un libellé générique remonte.
    return { httpCode: SPAPI_NETWORK_ERROR_CODE, payload: null };
  }

  var httpCode = response.getResponseCode();
  return {
    httpCode: httpCode,
    payload: httpCode === HTTP_OK ? parsePayload_(response.getContentText()) : null
  };
}

function restrictionsUrl_(asin, context) {
  return SPAPI_HOST + RESTRICTIONS_PATH +
      '?asin=' + encodeURIComponent(asin) +
      '&sellerId=' + encodeURIComponent(context.sellerId) +
      '&marketplaceIds=' + encodeURIComponent(context.marketplaceId);
}

function parsePayload_(body) {
  try {
    return JSON.parse(body);
  } catch (error) {
    return null;
  }
}

/**
 * Traduit une réponse HTTP en statut de feuille, ou en signal d'arrêt du run.
 *
 * Un retour `{ fatal: true, httpCode }` ne porte ni status ni code : par
 * construction il ne peut pas finir dans une cellule. C'est à l'appelant
 * (AsinCheck.gs) d'arrêter le run.
 */
function toOutcome_(response) {
  if (response.httpCode === HTTP_OK) {
    return response.payload ?
        classifyRestrictions_(response.payload) :
        { status: ASIN_STATUS.error, code: SPAPI_UNREADABLE_LABEL };
  }
  if (response.httpCode === HTTP_UNAUTHORIZED || response.httpCode === HTTP_FORBIDDEN) {
    // Cause globale (jeton, Seller ID, droits de l'application) et non propre à
    // cet ASIN : écrire ERROR sur chaque ligne n'aurait aucun sens.
    return { fatal: true, httpCode: response.httpCode };
  }
  if (response.httpCode === HTTP_BAD_REQUEST) {
    // ASIN mal formé ou refusé en entrée : définitif, relancer n'y changerait rien.
    return { status: ASIN_STATUS.invalidAsin, code: '' };
  }
  if (response.httpCode === HTTP_NOT_FOUND) {
    return { status: ASIN_STATUS.notFound, code: '' };
  }
  if (response.httpCode === SPAPI_NETWORK_ERROR_CODE) {
    return { status: ASIN_STATUS.error, code: SPAPI_NETWORK_ERROR_LABEL };
  }
  return { status: ASIN_STATUS.error, code: 'HTTP ' + response.httpCode };
}

/**
 * Statut d'un ASIN à partir d'une réponse « restrictions ».
 *
 * ATTENTION : les « links » qui distinguent APPROVAL_REQUIRED de NOT_ELIGIBLE
 * sont portés par restrictions[i].reasons[j].links — et non par restrictions[i].
 *
 * @return {Object} { status, code }
 */
function classifyRestrictions_(payload) {
  var restrictions = payload.restrictions || [];
  var relevant = restrictions.filter(appliesToNewCondition_);
  if (relevant.length === 0) {
    return { status: ASIN_STATUS.eligible, code: '' };
  }

  var reasons = collectReasons_(relevant);
  var needsApproval = reasons.some(function (reason) {
    return Boolean(reason.links) && reason.links.length > 0;
  });
  return {
    status: needsApproval ? ASIN_STATUS.approvalRequired : ASIN_STATUS.notEligible,
    code: distinctReasonCodes_(reasons).join(', ')
  };
}

/**
 * Une entrée sans conditionType s'applique à toutes les conditions, « new »
 * comprise : l'écarter ferait remonter ELIGIBLE à tort.
 */
function appliesToNewCondition_(restriction) {
  if (!restriction.conditionType) {
    return true;
  }
  return String(restriction.conditionType).toLowerCase() === CONDITION_TYPE_NEW;
}

/** Aplatit les reasons[] de toutes les restrictions retenues. */
function collectReasons_(restrictions) {
  var reasons = [];
  restrictions.forEach(function (restriction) {
    (restriction.reasons || []).forEach(function (reason) {
      reasons.push(reason);
    });
  });
  return reasons;
}

function distinctReasonCodes_(reasons) {
  var codes = [];
  reasons.forEach(function (reason) {
    if (reason.reasonCode && codes.indexOf(reason.reasonCode) === -1) {
      codes.push(reason.reasonCode);
    }
  });
  return codes;
}
