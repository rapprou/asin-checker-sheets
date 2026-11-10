/**
 * AsinCheck.gs — cœur d'un run de vérification.
 *
 * Un run traite les lignes dont la colonne B est vide ou vaut ERROR, à
 * ~4 requêtes/seconde, et s'arrête de lui-même avant la limite d'exécution
 * d'Apps Script. Les résultats sont écrits par paquets pendant la boucle, puis
 * le reste dans un finally : une interruption ne perd rien, et relancer reprend
 * là où ça s'est arrêté.
 *
 * runAsinCheck_() n'affiche **rien** : il rend un compte-rendu. C'est ce qui
 * permet deux appelants — l'entrée de menu checkAsins(), qui traduit le
 * compte-rendu en alerte ou en toast, et le panneau (Sidebar.gs), qui l'affiche
 * et enchaîne les tranches tant que la fin vaut « timeout ».
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

/**
 * Nombre de résultats accumulés avant écriture dans la feuille.
 *
 * Tout écrire à la fin de la tranche laisserait les compteurs du panneau figés
 * pendant 4 min 30. Écrire ligne à ligne multiplierait les appels à Sheets.
 * À 20, la progression avance toutes les ~5 s à la cadence du run — et c'est la
 * valeur à changer si ce compromis doit bouger.
 */
var RESULT_FLUSH_SIZE = 20;

var RUN_TOAST_SECONDS = 10;

/**
 * Fins de run possibles. Contrat partagé avec SidebarPanel.html, qui relance
 * sur « timeout » et s'arrête sur les trois autres.
 */
var RUN_END_DONE = 'done';
var RUN_END_TIMEOUT = 'timeout';
var RUN_END_STOPPED = 'stopped';
var RUN_END_FATAL = 'fatal';

/** Dernières lignes renvoyées au panneau pour son journal. */
var RUN_JOURNAL_MAX_LINES = 12;

/**
 * Attente maximale du verrou. Volontairement courte : si un run tourne déjà,
 * il tourne pour plusieurs minutes et il n'y a rien à attendre.
 */
var RUN_LOCK_WAIT_MILLIS = 1000;

var RUN_CONFIG_TITLE = 'Vérification impossible';
var RUN_CONFIG_PREFIX = 'Configuration incomplète : ';
var RUN_AUTH_TITLE = 'Authentification Amazon';
var RUN_STOPPED_TITLE = 'Vérification interrompue';
var RUN_LOCKED_TITLE = 'Vérification déjà en cours';
var RUN_LOCKED_MESSAGE =
    'Une vérification est déjà en cours dans ce classeur (panneau ouvert dans ' +
    'un autre onglet, ou exécution lancée depuis le menu).\n\nAttendez qu\'elle ' +
    'se termine, ou cliquez sur « Arrêter » dans le panneau.';
var RUN_NOTHING_TO_DO_MESSAGE =
    "Aucun ASIN à vérifier : la colonne A est vide, ou toutes les lignes ont déjà un statut " +
    'définitif.';

/** Rappel ajouté au toast du menu, où rien ne relance le run automatiquement. */
var RUN_TIMEOUT_MENU_HINT = ' Relancez « Vérifier les ASINs » pour continuer.';

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

/**
 * Entrée de menu « Vérifier les ASINs » : une chaîne d'une seule tranche.
 * newChain suffit — le serveur fixe lui-même chainStart, donc ce run reprend
 * tous les ERROR existants.
 */
function checkAsins() {
  var result = runAsinCheck_({ newChain: true });
  if (result.end === RUN_END_FATAL) {
    var ui = SpreadsheetApp.getUi();
    ui.alert(result.title, result.message, ui.ButtonSet.OK);
    return;
  }
  showToast_(
      result.message + (result.end === RUN_END_TIMEOUT ? RUN_TIMEOUT_MENU_HINT : ''),
      RUN_TOAST_SECONDS);
}

/**
 * Une tranche de vérification, sans aucun affichage.
 *
 * @param {Object} options
 *     chainStart — début de chaîne rendu par la tranche précédente, repassé
 *         tel quel (voir resolveChainStart_ et selectPendingRows_) ;
 *     newChain — vrai au premier appel seulement : le serveur fixe alors
 *         lui-même chainStart et efface le drapeau d'arrêt.
 * @return {Object} { end, checked, remaining, retried, undated, message, title,
 *     chainStart, lines }. Les compteurs portent sur **cette tranche** ;
 *     `chainStart` est à repasser à la tranche suivante ; `title` ne sert qu'à
 *     l'alerte du menu.
 */
function runAsinCheck_(options) {
  var chainStart = resolveChainStart_(options, Date.now());
  var sheet = ensureAsinsSheet_();

  var problems = validateSettings_();
  if (problems.length > 0) {
    // Configuration incomplète : aucun appel réseau.
    return runOutcome_(RUN_END_FATAL, RUN_CONFIG_TITLE,
        RUN_CONFIG_PREFIX + problems.join(' ; ') + '.', chainStart);
  }

  // Deux runs simultanés se partageraient les mêmes lignes et doubleraient les
  // requêtes. Le verrou est pris avant la lecture des lignes à traiter, et
  // relâché dans un finally.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(RUN_LOCK_WAIT_MILLIS)) {
    return runOutcome_(RUN_END_FATAL, RUN_LOCKED_TITLE, RUN_LOCKED_MESSAGE, chainStart);
  }

  try {
    if (options && options.newChain) {
      // Un « Arrêter » resté en cache ne doit pas tuer la chaîne suivante.
      // Effacé sous le verrou : un second panneau refusé plus haut n'a ainsi
      // aucun moyen d'annuler un « Arrêter » destiné à la chaîne en cours.
      clearRunStop_();
    }

    var pending = readPendingRows_(sheet, chainStart);
    if (pending.rows.length === 0) {
      return runOutcome_(RUN_END_DONE, '', RUN_NOTHING_TO_DO_MESSAGE, chainStart);
    }

    var token = getAccessToken_();
    if (!token.ok) {
      // lwaErrorMessage_ passe par une allowlist : aucun secret, aucun corps de réponse.
      return runOutcome_(RUN_END_FATAL, RUN_AUTH_TITLE, lwaErrorMessage_(token), chainStart);
    }

    return runChecks_(sheet, pending, buildContext_(token), chainStart);
  } finally {
    lock.releaseLock();
  }
}

/** Compte-rendu sans vérification effectuée (configuration, verrou, jeton). */
function runOutcome_(end, title, message, chainStart) {
  return {
    end: end,
    checked: 0,
    remaining: 0,
    retried: 0,
    undated: 0,
    message: message,
    title: title,
    chainStart: chainStart,
    lines: []
  };
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
 * @return {Object} Compte-rendu, même forme que runOutcome_.
 */
function runChecks_(sheet, pending, context, chainStart) {
  var results = [];
  var written = 0;
  var state = { tokenRefreshed: false, fatal: null, stopped: false };
  var startedAt = Date.now();

  try {
    for (var i = 0; i < pending.rows.length; i++) {
      if (isRunStopRequested_()) {
        // Arrêt demandé depuis le panneau : les lignes restantes gardent leur
        // colonne B et seront reprises.
        state.stopped = true;
        break;
      }
      if (Date.now() - startedAt > MAX_RUN_MILLIS) {
        // Budget épuisé : la tranche suivante prendra la suite.
        break;
      }
      if (i > 0) {
        Utilities.sleep(REQUEST_INTERVAL_MILLIS);
      }

      var outcome = checkAsinWithRefresh_(pending.rows[i].asin, context, state);
      if (outcome.fatal) {
        // Arrêt immédiat, sans résultat pour cette ligne : elle et les suivantes
        // gardent leur colonne B, donc le prochain run les reprendra.
        clearCachedToken_();
        state.fatal = outcome;
        break;
      }

      results.push({
        row: pending.rows[i].row,
        asin: pending.rows[i].asin,
        status: outcome.status,
        code: outcome.code,
        checkedAt: new Date(),
        isRetry: pending.rows[i].isRetry
      });

      if (shouldFlush_(results.length - written, RESULT_FLUSH_SIZE)) {
        written += flushResults_(sheet, unwrittenResults_(results, written));
      }
    }
  } finally {
    // Le reste, jamais ce qui est déjà écrit. Si un flush de la boucle a échoué
    // en cours de route, `written` n'a pas bougé et ces lignes repassent ici —
    // mêmes valeurs aux mêmes lignes, donc sans effet de bord.
    flushResults_(sheet, unwrittenResults_(results, written));
  }

  return buildRunReport_(results, pending, state, chainStart);
}

/**
 * Écrit un paquet et le rend visible aux autres exécutions.
 *
 * SpreadsheetApp.flush() est indispensable : le sondage getCounters() du
 * panneau est une **autre exécution**, et sans vidage explicite il ne verrait
 * pas les écritures de celle-ci — la barre de progression resterait figée
 * jusqu'à la fin de la tranche, ce que ce découpage existe pour éviter.
 *
 * @return {number} Nombre de résultats écrits, à ajouter au compteur.
 */
function flushResults_(sheet, batch) {
  if (batch.length === 0) {
    return 0;
  }
  writeResults_(sheet, batch);
  SpreadsheetApp.flush();
  return batch.length;
}

/**
 * Résultats accumulés depuis la dernière écriture. Fonction pure.
 * `results` reste la liste complète de la tranche — c'est elle qui sert au
 * bilan, au journal et au comptage des relances.
 */
function unwrittenResults_(results, writtenCount) {
  return results.slice(writtenCount);
}

/** Le paquet est-il complet ? Fonction pure. */
function shouldFlush_(unwrittenCount, size) {
  return size > 0 && unwrittenCount >= size;
}

/** Traduit l'état final de la boucle en compte-rendu. */
function buildRunReport_(results, pending, state, chainStart) {
  var remaining = pending.rows.length - results.length;
  var end = runEnd_(state, remaining);
  if (end === RUN_END_STOPPED) {
    // Le drapeau a joué son rôle : la chaîne est finie, il ne doit pas tuer la
    // suivante. Il est effacé ici, et non entre deux tranches.
    clearRunStop_();
  }

  var summary = runSummary_(results, remaining, pending.undatedRetries, end);
  return {
    end: end,
    checked: results.length,
    remaining: remaining,
    // Totaux de **cette tranche**. Le panneau les cumule sur la chaîne, que le
    // serveur ne connaît pas : chaque tranche est une exécution distincte.
    retried: countRetries_(results),
    undated: pending.undatedRetries,
    message: end === RUN_END_FATAL ? summary + '\n\n' + fatalMessage_(state.fatal) : summary,
    title: end === RUN_END_FATAL ? RUN_STOPPED_TITLE : '',
    // Repassé tel quel par le panneau à la tranche suivante.
    chainStart: chainStart,
    lines: journalLines_(results)
  };
}

function runEnd_(state, remaining) {
  if (state.fatal) {
    return RUN_END_FATAL;
  }
  if (state.stopped) {
    return RUN_END_STOPPED;
  }
  return remaining > 0 ? RUN_END_TIMEOUT : RUN_END_DONE;
}

/**
 * Bilan de la tranche : distingue les nouvelles lignes des ERROR relancées, et
 * signale les dates illisibles rencontrées. Ce comptage remplace un log —
 * le projet n'en a aucun, par la règle de non-fuite des secrets.
 */
function runSummary_(results, remaining, undatedRetries, end) {
  var retried = countRetries_(results);
  var message = results.length + ' ASIN(s) vérifié(s)';
  if (retried > 0) {
    message += ' : ' + (results.length - retried) + ' nouveau(x), ' + retried +
        ' relancé(s) après ERROR';
  }
  message += '.';

  if (undatedRetries > 0) {
    message += ' ' + undatedRetries + ' ligne(s) ERROR sans date lisible en colonne D, ' +
        'reprise(s) par précaution.';
  }
  if (end === RUN_END_STOPPED) {
    message = 'Arrêt demandé. ' + message;
  }
  if (remaining > 0) {
    message += ' ' + remaining + ' restant(s).';
  }
  return message;
}

/** Dernières lignes traitées, pour le journal du panneau. Aucun secret : ASIN et statut. */
function journalLines_(results) {
  return results.slice(-RUN_JOURNAL_MAX_LINES).map(function (result) {
    return { asin: result.asin, status: result.status, code: result.code };
  });
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

function countRetries_(results) {
  return results.filter(function (result) {
    return result.isRetry;
  }).length;
}
