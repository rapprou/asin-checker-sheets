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

/**
 * Préfixe des conditions qui nous intéressent. Amazon ne renvoie jamais « new »
 * seul mais des valeurs déclinées : new_new, new_open_box, new_oem… Les
 * used_*, collectible_* et refurbished_* sont écartées.
 */
var CONDITION_TYPE_NEW_PREFIX = 'new';

/**
 * Motif renvoyé avec un HTTP 200 pour un ASIN inexistant : la restriction n'a
 * alors pas de conditionType et ses links sont vides.
 */
var REASON_ASIN_NOT_FOUND = 'ASIN_NOT_FOUND';

/**
 * Format d'un ASIN après normalisation (trim + majuscules par normalizeAsin_,
 * dans Asins.gs). Un ASIN hors format est rejeté localement : Amazon répondrait
 * 400, un code qui signale désormais un problème de configuration.
 */
var ASIN_FORMAT = /^[A-Z0-9]{10}$/;
var ASIN_INVALID_FORMAT_CODE = 'FORMAT';

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
  if (!isValidAsinFormat_(asin)) {
    // Rejet local : définitif, et aucun appel réseau gaspillé.
    return { status: ASIN_STATUS.invalidAsin, code: ASIN_INVALID_FORMAT_CODE };
  }

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

/** Un ASIN déjà normalisé a-t-il le format attendu par l'API ? */
function isValidAsinFormat_(asin) {
  return ASIN_FORMAT.test(asin);
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
  if (isFatalHttpCode_(response.httpCode)) {
    // Cause globale et non propre à cet ASIN — l'ASIN mal formé a déjà été
    // filtré localement, donc un 400 ici vient du sellerId ou du marketplaceId.
    // Écrire un statut sur chaque ligne n'aurait aucun sens.
    return { fatal: true, httpCode: response.httpCode };
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
 * Codes qui arrêtent le run : la cause est globale, pas propre à un ASIN.
 * 400 en fait partie depuis que le format de l'ASIN est validé en local — il ne
 * reste alors que « Invalid 'sellerId' » ou un marketplaceId refusé.
 */
function isFatalHttpCode_(httpCode) {
  return httpCode === HTTP_BAD_REQUEST ||
      httpCode === HTTP_UNAUTHORIZED ||
      httpCode === HTTP_FORBIDDEN;
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
  var codes = distinctReasonCodes_(reasons);
  if (codes.indexOf(REASON_ASIN_NOT_FOUND) !== -1) {
    // ASIN inexistant : Amazon répond 200 avec ce motif, sans conditionType ni
    // links. Sans ce test, il ressortirait NOT_ELIGIBLE.
    return { status: ASIN_STATUS.notFound, code: REASON_ASIN_NOT_FOUND };
  }

  var needsApproval = reasons.some(function (reason) {
    return Boolean(reason.links) && reason.links.length > 0;
  });
  return {
    status: needsApproval ? ASIN_STATUS.approvalRequired : ASIN_STATUS.notEligible,
    code: codes.join(', ')
  };
}

/**
 * Une entrée est retenue si conditionType est absent — elle s'applique alors à
 * toutes les conditions, « new » comprise — ou s'il commence par « new ».
 *
 * Comparer à « new » exactement ne marche pas : Amazon renvoie new_new,
 * new_open_box, new_oem… Une égalité stricte ne matcherait jamais et toute
 * restriction sur du neuf passerait pour ELIGIBLE.
 */
function appliesToNewCondition_(restriction) {
  if (!restriction.conditionType) {
    return true;
  }
  var conditionType = String(restriction.conditionType).trim().toLowerCase();
  return conditionType.indexOf(CONDITION_TYPE_NEW_PREFIX) === 0;
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
