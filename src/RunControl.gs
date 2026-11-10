/**
 * RunControl.gs — pilotage d'une chaîne de runs : drapeau d'arrêt et
 * horodatage de début de chaîne.
 *
 * Une « chaîne » est une suite de tranches : le panneau relance le run tant
 * qu'il rend « timeout », chaque tranche restant sous la limite d'exécution
 * d'Apps Script. Les deux mécanismes de ce fichier sont ce qui distingue une
 * chaîne d'une simple relance.
 *
 * Le drapeau vit dans le cache de script, pas dans une propriété : il est
 * volatil par nature, et un TTL garantit qu'un drapeau oublié (onglet fermé
 * entre le clic « Arrêter » et la fin du run) ne bloque pas les runs suivants.
 * Cache de script et verrou de script, comme le jeton LWA : chaque client a sa
 * propre copie du script, liée à un seul classeur.
 */

var STOP_FLAG_CACHE_KEY = 'ASIN_RUN_STOP';
var STOP_FLAG_VALUE = '1';

/** 10 min : au-delà, un drapeau resté en place est forcément périmé. */
var STOP_FLAG_SECONDS = 600;

/**
 * Demande l'arrêt du run en cours. Ne prend aucun verrou : le run le détient,
 * et attendre le verrou ici ne rendrait la main qu'une fois le run terminé —
 * exactement ce que le bouton cherche à éviter.
 */
function requestRunStop_() {
  CacheService.getScriptCache().put(STOP_FLAG_CACHE_KEY, STOP_FLAG_VALUE, STOP_FLAG_SECONDS);
}

function isRunStopRequested_() {
  return CacheService.getScriptCache().get(STOP_FLAG_CACHE_KEY) === STOP_FLAG_VALUE;
}

/**
 * Efface le drapeau. Appelé au démarrage d'une chaîne et quand un run s'est
 * réellement arrêté dessus — mais jamais entre deux tranches : le drapeau doit
 * survivre à la tranche qui le lit pour que la chaîne entière s'arrête.
 */
function clearRunStop_() {
  CacheService.getScriptCache().remove(STOP_FLAG_CACHE_KEY);
}

/**
 * Début de chaîne d'une tranche. Fonction pure.
 *
 * Le serveur est seul maître de l'horloge : au premier appel (newChain) il fixe
 * lui-même l'instant de départ et ignore ce que le client a pu envoyer, puis le
 * rend dans le compte-rendu. Les tranches suivantes ne font que le repasser, et
 * il traverse la chaîne inchangé.
 *
 * C'est ce qui garantit la stabilité de chainStart, et donc l'arrêt de la
 * chaîne : laisser chaque tranche repartir d'une horloge faisait avancer la
 * valeur de tranche en tranche, et les ERROR écrits par les tranches
 * précédentes redevenaient « anciens » — donc retentés indéfiniment.
 *
 * @param {Object} options { chainStart, newChain } reçus du client.
 * @param {number} now Date.now() côté serveur.
 * @return {number}
 */
function resolveChainStart_(options, now) {
  if (options && options.newChain) {
    return now;
  }
  return normalizeChainStart_(options && options.chainStart, now);
}

/**
 * Filet de sécurité sur la valeur repassée par le client : jamais de date
 * future, jamais de valeur illisible.
 *
 * Les dates de la colonne D sont écrites avec l'horloge du serveur. Une valeur
 * future rendrait « anciens » des ERROR écrits pendant la chaîne, qui seraient
 * alors retentés à chaque tranche. Une valeur en retard est sans danger : elle
 * ne fait que reprendre moins d'ERROR anciens, que la chaîne suivante
 * reprendra.
 *
 * @param {*} value chainStart reçu du client.
 * @param {number} now Date.now() côté serveur.
 * @return {number}
 */
function normalizeChainStart_(value, now) {
  var chainStart = Number(value);
  if (!isFinite(chainStart) || chainStart <= 0 || chainStart > now) {
    return now;
  }
  return chainStart;
}
