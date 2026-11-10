/**
 * Statuses.gs — source unique de vérité pour l'affichage des statuts.
 *
 * Les valeurs elles-mêmes restent définies une seule fois, dans ASIN_STATUS
 * (Asins.gs) ; ce fichier n'y ajoute que l'ordre d'affichage et les couleurs.
 * Couleurs de l'onglet « ASINs », du Récap et du panneau viennent d'ici :
 * aucun statut ni aucune couleur ne doit être écrit en dur ailleurs.
 *
 * La table est portée par une fonction et non par une constante racine : elle
 * lit ASIN_STATUS, défini dans un autre fichier .gs, et l'ordre de chargement
 * n'est pas garanti au niveau racine.
 */

/**
 * Statuts dans l'ordre d'affichage, avec leur mise en forme.
 * ERROR est le seul statut transitoire : sa mise en forme est volontairement
 * plus agressive (fond soutenu, gras) puisqu'il appelle une relance.
 *
 * @return {Array<Object>} [{ status, background, fontColor, bold }]
 */
function statusStyles_() {
  return [
    { status: ASIN_STATUS.eligible, background: '#e6f4ea', fontColor: '#137333', bold: false },
    { status: ASIN_STATUS.approvalRequired, background: '#fef7e0', fontColor: '#b06000', bold: false },
    { status: ASIN_STATUS.notEligible, background: '#fce8e6', fontColor: '#b00020', bold: false },
    { status: ASIN_STATUS.notFound, background: '#f1f3f4', fontColor: '#5f6368', bold: false },
    { status: ASIN_STATUS.invalidAsin, background: '#f3e8fd', fontColor: '#7627bb', bold: false },
    { status: ASIN_STATUS.error, background: '#b00020', fontColor: '#ffffff', bold: true }
  ];
}

/**
 * Les statuts seuls, dans l'ordre d'affichage. C'est cette liste que le Récap
 * et le panneau parcourent : aucun des deux ne cite un statut en dur.
 * @return {Array<string>}
 */
function statusList_() {
  return statusStyles_().map(function (style) {
    return style.status;
  });
}

/**
 * Mise en forme d'un statut, ou null s'il n'en a pas.
 * @param {string} status Valeur de la colonne B.
 */
function statusStyle_(status) {
  var matches = statusStyles_().filter(function (style) {
    return style.status === status;
  });
  return matches.length === 1 ? matches[0] : null;
}
