/**
 * Sidebar.gs — panneau de pilotage d'un run.
 *
 * Le panneau existe pour une raison : une liste de ~400 ASINs dépasse la limite
 * d'exécution d'Apps Script. Le run rend « timeout » quand son budget est
 * épuisé, et c'est le JavaScript du panneau qui relance la tranche suivante —
 * un enchaînement impossible depuis une entrée de menu.
 *
 * Ce fichier ne contient que les points d'entrée appelés par
 * google.script.run : ils délèguent et ne décident de rien.
 *
 * Aucune clé ni aucun jeton ne transite par le panneau. Le gabarit ne reçoit
 * que la table des couleurs (Statuses.gs) ; les comptes-rendus ne portent que
 * des ASINs, des statuts et des messages d'allowlist.
 *
 * Ce fichier ne peut pas s'appeler SidebarPanel.gs : Apps Script identifie les
 * fichiers par leur nom sans extension, et SidebarPanel est déjà pris par le
 * gabarit SidebarPanel.html.
 */

var SIDEBAR_TEMPLATE_NAME = 'SidebarPanel';
var SIDEBAR_TITLE = 'ASIN Checker';

var STOP_REQUESTED_MESSAGE =
    'Stop requested: the check will stop after the current ASIN.';

/** Entrée de menu « Open panel ». */
function showSidebar() {
  ensureAsinsSheet_();
  SpreadsheetApp.getUi().showSidebar(buildSidebar_());
}

function buildSidebar_() {
  var template = HtmlService.createTemplateFromFile(SIDEBAR_TEMPLATE_NAME);
  // Les couleurs viennent de la même source que la feuille et l'onglet « Summary ».
  template.styles = statusStyles_();
  return template.evaluate().setTitle(SIDEBAR_TITLE);
}

/**
 * Une tranche de vérification. Appelée en boucle par le panneau tant que la
 * réponse vaut « timeout ».
 *
 * Au premier appel, le panneau n'envoie que newChain : c'est le serveur qui
 * fixe chainStart et le rend dans le compte-rendu, pour que les tranches
 * suivantes le repassent inchangé (voir resolveChainStart_).
 *
 * @param {Object} options { chainStart, newChain } — voir runAsinCheck_.
 */
function runFromSidebar(options) {
  return runAsinCheck_({
    chainStart: options ? options.chainStart : null,
    newChain: Boolean(options && options.newChain)
  });
}

/**
 * Comptes par statut, pour le sondage du panneau (~5 s pendant un run).
 * Volontairement léger : une lecture de A:B, sans verrou ni appel SP-API, donc
 * sans jamais bloquer le run en cours.
 */
function getCounters() {
  return readStatusCounts_(findAsinsSheet_());
}

/**
 * Demande l'arrêt de la chaîne. Ne prend pas le verrou : il est détenu par le
 * run, et l'attendre ne rendrait la main qu'une fois celui-ci terminé.
 */
function stopRun() {
  requestRunStop_();
  return { message: STOP_REQUESTED_MESSAGE };
}
