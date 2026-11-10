/**
 * tests/classify.js — tests de la classification des réponses SP-API.
 *
 *   node tests/classify.js
 *
 * Ce qui est testé : classifyRestrictions_, toOutcome_ et isPendingStatus_, soit
 * toute la logique pure de décision. Aucun appel réseau, aucun service Apps
 * Script : les fichiers src/*.gs sont chargés et évalués dans une portée isolée.
 *
 * Ce qui n'est pas testable ici : tout ce qui touche à SpreadsheetApp,
 * UrlFetchApp, PropertiesService ou CacheService — cela reste couvert par la
 * checklist manuelle de CLAUDE.md.
 *
 * Ce fichier et tests/fixtures/ ne contiennent volontairement AUCUNE clé, AUCUN
 * jeton et AUCUN Seller ID : les fixtures sont des réponses d'API, pas des
 * configurations. Avant d'ajouter une capture, relire ses links[].resource :
 * ce sont les seuls champs susceptibles de porter des paramètres de compte.
 *
 * Note sur clasp : seul src/ est poussé (rootDir dans .clasp.json), donc ce
 * dossier ne part jamais vers le projet Apps Script.
 */

'use strict';

var fs = require('fs');
var path = require('path');

var SRC_DIR = path.join(__dirname, '..', 'src');

/**
 * Charge un fichier .gs et renvoie les symboles demandés.
 *
 * Les `var` de haut niveau du fichier deviennent des variables locales de la
 * fonction construite : rien ne fuit dans le scope global du test, et deux
 * fichiers peuvent déclarer la même constante sans se marcher dessus.
 */
function loadGs(fileName, exportedNames, injected) {
  var source = fs.readFileSync(path.join(SRC_DIR, fileName), 'utf8');
  var injectedNames = Object.keys(injected || {});
  var body = source + '\nreturn {' +
      exportedNames.map(function (name) { return name + ': ' + name; }).join(', ') + '};';
  // Function.apply : les premiers arguments sont les paramètres, le dernier le corps.
  var factory = Function.apply(null, injectedNames.concat([body]));
  return factory.apply(null, injectedNames.map(function (name) { return injected[name]; }));
}

var asins = loadGs('Asins.gs',
    ['ASIN_STATUS', 'ASIN_FIRST_DATA_ROW', 'isPendingStatus_', 'normalizeAsin_']);
var ASIN_STATUS = asins.ASIN_STATUS;

/**
 * UrlFetchApp qui explose : aucun test ne doit déclencher d'appel réseau. Sert
 * aussi à prouver l'inverse — qu'un ASIN bien formé va, lui, jusqu'à l'appel.
 */
var NETWORK_FORBIDDEN_MESSAGE = 'appel réseau interdit dans les tests';
var NETWORK_FORBIDDEN = {
  fetch: function () {
    throw new Error(NETWORK_FORBIDDEN_MESSAGE);
  }
};

var restrictions = loadGs(
    'Restrictions.gs',
    ['classifyRestrictions_', 'toOutcome_', 'appliesToNewCondition_', 'checkAsin_',
      'isValidAsinFormat_'],
    {
      ASIN_STATUS: ASIN_STATUS,
      UrlFetchApp: NETWORK_FORBIDDEN,
      Utilities: { sleep: function () {} }
    });

/**
 * Statuses.gs et Formatting.gs — la table statut → couleur et la reconnaissance
 * des règles de mise en forme conditionnelle. Formatting.gs reçoit statusStyles_
 * en injection : les deux fichiers partagent le même scope global dans Apps
 * Script, pas ici.
 */
var statuses = loadGs('Statuses.gs', ['statusStyles_', 'statusStyle_'],
    { ASIN_STATUS: ASIN_STATUS });

var formatting = loadGs(
    'Formatting.gs',
    ['statusFormatFormula_', 'isStatusFormatFormula_', 'normalizeFormula_'],
    {
      ASIN_FIRST_DATA_ROW: asins.ASIN_FIRST_DATA_ROW,
      statusStyles_: statuses.statusStyles_
    });

/** Contexte de test : volontairement vide, aucun secret n'a sa place ici. */
var DUMMY_CONTEXT = { accessToken: '', sellerId: '', marketplaceId: '' };

/**
 * Fixture B0CHXMX9XC — réponse SP-API réelle, capturée le 10/11/2026 sur la
 * marketplace FR, conservée telle quelle dans tests/fixtures/.
 *
 * C'est le cas qui a révélé le bug de conditionType : la réponse déclare dix
 * conditions, dont une seule en « new_new » (avec links dans reasons[]). Les
 * neuf autres sont des used_*, collectible_* et refurbished_* qui doivent être
 * écartées. Une égalité stricte sur « new » ne matche aucune des dix et rend
 * ELIGIBLE un ASIN pourtant restreint dans toutes ses conditions.
 *
 * Relu avant commit : les links[].resource ne portent que l'ASIN, aucun Seller
 * ID ni jeton. Le marketplaceId FR est une donnée publique.
 */
var FIXTURE_B0CHXMX9XC = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'B0CHXMX9XC.json'), 'utf8'));

/**
 * Fixture B000000000 — ASIN inexistant, réponse constatée le 10/11/2026 (FR).
 *
 * Amazon répond **200**, pas 404 : une restriction sans conditionType, avec
 * reasonCode ASIN_NOT_FOUND et des links vides. Sans traitement particulier,
 * cette réponse ressortirait NOT_ELIGIBLE — l'entrée est retenue (pas de
 * conditionType) et n'a pas de links.
 *
 * Forme reconstituée d'après la réponse constatée, et non capturée octet pour
 * octet : elle fige les trois caractéristiques qui comptent (code 200,
 * conditionType absent, reasonCode ASIN_NOT_FOUND).
 */
var FIXTURE_B000000000 = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'B000000000.json'), 'utf8'));

var failures = 0;
var checks = 0;

function check(label, actual, expected) {
  checks++;
  var ok = actual === expected;
  if (!ok) {
    failures++;
  }
  console.log((ok ? 'OK    ' : 'ÉCHEC ') + label +
      (ok ? '' : '  → ' + actual + ' (attendu ' + expected + ')'));
}

function classify(label, payload, expected) {
  check(label, restrictions.classifyRestrictions_(payload).status, expected);
}

console.log('— Non-régression conditionType (le bug : égalité stricte sur « new ») —');
classify('B0CHXMX9XC, réponse réelle du 10/11/2026', FIXTURE_B0CHXMX9XC,
    ASIN_STATUS.approvalRequired);
// Le code vient des seules conditions retenues : si le filtre sautait, on verrait
// aussi le NOT_ELIGIBLE du refurbished_refurbished.
check('B0CHXMX9XC → code APPROVAL_REQUIRED seul',
    restrictions.classifyRestrictions_(FIXTURE_B0CHXMX9XC).code, 'APPROVAL_REQUIRED');

// Garde-fou sur la fixture elle-même : si une capture future perdait l'une de ces
// deux propriétés, le test ci-dessus passerait sans plus rien démontrer.
var fixtureConditions = FIXTURE_B0CHXMX9XC.restrictions.map(function (entry) {
  return String(entry.conditionType || '').toLowerCase();
});
var fixtureHasLinksOutsideNew = FIXTURE_B0CHXMX9XC.restrictions.some(function (entry) {
  var isNew = String(entry.conditionType || '').toLowerCase().indexOf('new') === 0;
  return !isNew && (entry.reasons || []).some(function (reason) {
    return (reason.links || []).length > 0;
  });
});
check('la fixture contient une condition new_* déclinée',
    fixtureConditions.some(function (conditionType) {
      return conditionType.indexOf('new') === 0 && conditionType !== 'new';
    }), true);
check('la fixture contient des links hors new_* (sinon le filtre n\'est pas testé)',
    fixtureHasLinksOutsideNew, true);
classify('new_open_box sans links', {
  restrictions: [{ conditionType: 'new_open_box', reasons: [{ reasonCode: 'NOT_ELIGIBLE' }] }]
}, ASIN_STATUS.notEligible);
classify('new_oem avec espaces et majuscules', {
  restrictions: [{ conditionType: ' NEW_OEM ', reasons: [{ links: [{}] }] }]
}, ASIN_STATUS.approvalRequired);

console.log('\n— Conditions écartées —');
classify('used_* uniquement, links compris', {
  restrictions: [
    { conditionType: 'used_good', reasons: [{ reasonCode: 'APPROVAL_REQUIRED', links: [{}] }] },
    { conditionType: 'used_like_new', reasons: [{ links: [{}] }] }
  ]
}, ASIN_STATUS.eligible);
classify('collectible_* et refurbished_*', {
  restrictions: [
    { conditionType: 'collectible_like_new', reasons: [{ links: [{}] }] },
    { conditionType: 'refurbished_refurbished', reasons: [{ links: [{}] }] }
  ]
}, ASIN_STATUS.eligible);
classify('les links d\'une condition écartée ne contaminent pas le neuf', {
  restrictions: [
    { conditionType: 'used_good', reasons: [{ reasonCode: 'X', links: [{}] }] },
    { conditionType: 'new_new', reasons: [{ reasonCode: 'NOT_ELIGIBLE' }] }
  ]
}, ASIN_STATUS.notEligible);

console.log('\n— Format d\'ASIN : rejet local, aucun appel réseau —');
function checkFormat(label, raw, expected) {
  check(label, restrictions.isValidAsinFormat_(asins.normalizeAsin_(raw)), expected);
}
checkFormat('« XXX »', 'XXX', false);
checkFormat('minuscules et espaces normalisés', '  b0chxmx9xc  ', true);
checkFormat('9 caractères', 'B0CHXMX9X', false);
checkFormat('11 caractères', 'B0CHXMX9XC1', false);
checkFormat('caractère spécial en fin', 'B0CHXMX9X-', false);
checkFormat('tiret interne', 'B0CH-MX9XC', false);
checkFormat('accent', 'B0CHXMX9XÉ', false);
checkFormat('espace interne', 'B0CH MX9XC', false);
checkFormat('cellule vide', '', false);
checkFormat('dix chiffres', '1234567890', true);

var malformed = restrictions.checkAsin_(asins.normalizeAsin_('XXX'), DUMMY_CONTEXT);
check('« XXX » → INVALID_ASIN', malformed.status, ASIN_STATUS.invalidAsin);
check('« XXX » → code FORMAT', malformed.code, 'FORMAT');
// Preuve que le garde-fou local ne rejette pas trop large : un ASIN bien formé
// atteint UrlFetchApp. Le stub lève, fetchRestrictions_ traduit en httpCode 0,
// donc le résultat attendu est ERROR / RÉSEAU et non INVALID_ASIN.
var wellFormed = restrictions.checkAsin_('B0CHXMX9XC', DUMMY_CONTEXT);
check('un ASIN bien formé atteint l\'appel réseau', wellFormed.code, 'RÉSEAU');
check('un ASIN bien formé n\'est jamais INVALID_ASIN', wellFormed.status, ASIN_STATUS.error);

console.log('\n— ASIN inexistant : 200 + ASIN_NOT_FOUND —');
classify('B000000000, réponse constatée le 10/11/2026', FIXTURE_B000000000,
    ASIN_STATUS.notFound);
check('B000000000 → code ASIN_NOT_FOUND',
    restrictions.classifyRestrictions_(FIXTURE_B000000000).code, 'ASIN_NOT_FOUND');
classify('ASIN_NOT_FOUND avec un conditionType new_* aussi', {
  restrictions: [{ conditionType: 'new_new', reasons: [{ reasonCode: 'ASIN_NOT_FOUND' }] }]
}, ASIN_STATUS.notFound);

console.log('\n— Vendable —');
classify('restrictions: []', { restrictions: [] }, ASIN_STATUS.eligible);
classify('aucun champ restrictions', {}, ASIN_STATUS.eligible);

console.log('\n— links : emplacement et forme —');
classify('links sur le 2e reason seulement', {
  restrictions: [{
    conditionType: 'new_new',
    reasons: [{ reasonCode: 'NOT_ELIGIBLE' }, { reasonCode: 'APPROVAL_REQUIRED', links: [{}] }]
  }]
}, ASIN_STATUS.approvalRequired);
classify('links: [] compte comme absent', {
  restrictions: [{ conditionType: 'new_new', reasons: [{ links: [] }] }]
}, ASIN_STATUS.notEligible);
classify('links au niveau de restrictions[] est ignoré (piège n°1)', {
  restrictions: [{ conditionType: 'new_new', links: [{}], reasons: [{ reasonCode: 'NOT_ELIGIBLE' }] }]
}, ASIN_STATUS.notEligible);
classify('conditionType absent = toutes conditions', {
  restrictions: [{ reasons: [{ reasonCode: 'NOT_ELIGIBLE' }] }]
}, ASIN_STATUS.notEligible);

console.log('\n— Codes restriction en colonne C —');
check('reasonCode distincts joints',
    restrictions.classifyRestrictions_({
      restrictions: [{
        conditionType: 'new_new',
        reasons: [{ reasonCode: 'NOT_ELIGIBLE' }, { reasonCode: 'APPROVAL_REQUIRED', links: [{}] },
          { reasonCode: 'NOT_ELIGIBLE' }]
      }]
    }).code,
    'NOT_ELIGIBLE, APPROVAL_REQUIRED');
check('ELIGIBLE sans code', restrictions.classifyRestrictions_({ restrictions: [] }).code, '');

console.log('\n— Traduction des codes HTTP —');
check('404 → NOT_FOUND',
    restrictions.toOutcome_({ httpCode: 404, payload: null }).status, ASIN_STATUS.notFound);
check('503 → ERROR',
    restrictions.toOutcome_({ httpCode: 503, payload: null }).status, ASIN_STATUS.error);
check('503 → code HTTP seul',
    restrictions.toOutcome_({ httpCode: 503, payload: null }).code, 'HTTP 503');
check('0 (réseau) → ERROR',
    restrictions.toOutcome_({ httpCode: 0, payload: null }).status, ASIN_STATUS.error);
check('200 illisible → ERROR',
    restrictions.toOutcome_({ httpCode: 200, payload: null }).status, ASIN_STATUS.error);

console.log('\n— 400/401/403 : arrêt du run, jamais de statut écrit —');
// 400 doit être fatal et NON INVALID_ASIN : un mauvais Seller ID renvoie 400 sur
// chaque ASIN et marquerait sinon toute la liste d'un statut définitif.
[400, 401, 403].forEach(function (httpCode) {
  var outcome = restrictions.toOutcome_({ httpCode: httpCode, payload: null });
  check(httpCode + ' → fatal', outcome.fatal, true);
  check(httpCode + ' → httpCode conservé', outcome.httpCode, httpCode);
  // Invariant structurel : un outcome fatal ne peut pas atteindre une cellule.
  check(httpCode + ' → aucun status', outcome.status, undefined);
  check(httpCode + ' → aucun code', outcome.code, undefined);
});

console.log('\n— Statuts repris au run suivant —');
check('cellule vide → reprise', asins.isPendingStatus_(''), true);
check('ERROR → reprise', asins.isPendingStatus_(ASIN_STATUS.error), true);
[['eligible'], ['approvalRequired'], ['notEligible'], ['notFound'], ['invalidAsin']]
    .forEach(function (entry) {
      var status = ASIN_STATUS[entry[0]];
      check(status + ' → définitif', asins.isPendingStatus_(status), false);
    });

console.log('\n— Couleurs par statut : une seule source de vérité —');
var styles = statuses.statusStyles_();
// Barrière : ajouter un statut dans ASIN_STATUS sans lui donner de couleur fait
// tomber ces assertions. Et une couleur pour un statut qui n'existe pas non plus.
Object.keys(ASIN_STATUS).forEach(function (key) {
  var style = statuses.statusStyle_(ASIN_STATUS[key]);
  check(ASIN_STATUS[key] + ' a une mise en forme', Boolean(style), true);
  check(ASIN_STATUS[key] + ' a un fond', Boolean(style && style.background), true);
  check(ASIN_STATUS[key] + ' a une couleur de texte', Boolean(style && style.fontColor), true);
});
check('autant de mises en forme que de statuts',
    styles.length, Object.keys(ASIN_STATUS).length);
check('un statut inconnu n\'a pas de mise en forme',
    statuses.statusStyle_('AUTRE_CHOSE'), null);
check('fonds tous distincts',
    styles.map(function (style) { return style.background; })
        .filter(function (background, index, all) { return all.indexOf(background) !== index; })
        .length,
    0);
// ERROR est le seul statut transitoire : le seul mis en gras.
check('ERROR est en gras', statuses.statusStyle_(ASIN_STATUS.error).bold, true);
check('un seul statut en gras',
    styles.filter(function (style) { return style.bold; }).length, 1);

console.log('\n— Reconnaissance de nos règles (idempotence) —');
check('formule attendue pour ELIGIBLE',
    formatting.statusFormatFormula_(ASIN_STATUS.eligible), '=$B2="ELIGIBLE"');
styles.forEach(function (style) {
  check(style.status + ' : sa formule est reconnue',
      formatting.isStatusFormatFormula_(formatting.statusFormatFormula_(style.status)), true);
});
// Sheets peut renormaliser la formule rendue : la comparaison ignore espaces et casse.
check('formule espacée reconnue',
    formatting.isStatusFormatFormula_(' =$B2 = "ELIGIBLE" '), true);
check('formule en minuscules reconnue',
    formatting.isStatusFormatFormula_('=$b2="eligible"'), true);
// Une règle posée à la main par le client ne doit jamais être retirée.
check('règle étrangère non reconnue', formatting.isStatusFormatFormula_('=$A2=""'), false);
check('règle sur une autre colonne non reconnue',
    formatting.isStatusFormatFormula_('=$C2="ELIGIBLE"'), false);
check('formule vide non reconnue', formatting.isStatusFormatFormula_(''), false);

console.log('\n' + (checks - failures) + '/' + checks + ' conformes');
if (failures > 0) {
  console.log(failures + ' échec(s)');
}
process.exitCode = failures > 0 ? 1 : 0;
