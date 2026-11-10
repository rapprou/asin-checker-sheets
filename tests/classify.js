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

var asins = loadGs('Asins.gs', ['ASIN_STATUS', 'isPendingStatus_']);
var ASIN_STATUS = asins.ASIN_STATUS;

var restrictions = loadGs(
    'Restrictions.gs',
    ['classifyRestrictions_', 'toOutcome_', 'appliesToNewCondition_'],
    { ASIN_STATUS: ASIN_STATUS });

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
check('400 → INVALID_ASIN',
    restrictions.toOutcome_({ httpCode: 400, payload: null }).status, ASIN_STATUS.invalidAsin);
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

console.log('\n— 401/403 : arrêt du run, jamais de statut écrit —');
[401, 403].forEach(function (httpCode) {
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

console.log('\n' + (checks - failures) + '/' + checks + ' conformes');
if (failures > 0) {
  console.log(failures + ' échec(s)');
}
process.exitCode = failures > 0 ? 1 : 0;
