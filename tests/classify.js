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

/**
 * statusList_ vit dans Statuses.gs, qui lit lui-même ASIN_STATUS d'Asins.gs.
 * Dans Apps Script les deux partagent le scope global ; ici le chargement est
 * ordonné, donc Asins.gs reçoit une fonction qui lira la liste plus tard.
 */
var STATUS_LIST = null;

var asins = loadGs('Asins.gs',
    ['ASIN_STATUS', 'ASIN_SHEET_NAME', 'ASIN_FIRST_DATA_ROW', 'ASIN_COLUMNS',
      'isPendingStatus_', 'normalizeAsin_', 'selectPendingRows_', 'countStatuses_',
      'checkedAtMillis_'],
    { statusList_: function () { return STATUS_LIST; } });
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
      'isValidAsinFormat_', 'restrictionsUrl_'],
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
var statuses = loadGs('Statuses.gs', ['statusStyles_', 'statusStyle_', 'statusList_'],
    { ASIN_STATUS: ASIN_STATUS });

STATUS_LIST = statuses.statusList_();

var formatting = loadGs(
    'Formatting.gs',
    ['statusFormatFormula_', 'isStatusFormatFormula_', 'normalizeFormula_',
      'STATUS_FORMULA_COLUMN'],
    {
      ASIN_FIRST_DATA_ROW: asins.ASIN_FIRST_DATA_ROW,
      statusStyles_: statuses.statusStyles_
    });

/**
 * Summary.gs — le plan de l'onglet « Récap » est une fonction pure : toutes les
 * formules en sortent, et aucune n'est construite ailleurs.
 */
var summary = loadGs(
    'Summary.gs',
    ['summaryPlan_', 'asinRange_', 'separatorProbeFormula_', 'FORMULA_SEPARATORS',
      'SUMMARY_SHEET_NAME', 'LEGACY_SUMMARY_SHEET_NAME'],
    {
      ASIN_SHEET_NAME: asins.ASIN_SHEET_NAME,
      ASIN_FIRST_DATA_ROW: asins.ASIN_FIRST_DATA_ROW,
      statusList_: statuses.statusList_,
      isPendingStatus_: asins.isPendingStatus_
    });

/**
 * Config.gs — deux choses y sont exercées, celles qui ne touchent pas la
 * feuille : la résolution du nom d'onglet (elle reçoit le classeur en paramètre)
 * et la table des marketplaces avec ses libellés et sa résolution par libellé.
 *
 * readMarketplace_ n'est volontairement pas exportée : elle lit la cellule B5 et
 * appellerait SpreadsheetApp. C'est tout l'intérêt d'en avoir extrait la
 * fonction pure findMarketplaceByLabel_.
 */
var config = loadGs(
    'Config.gs',
    ['findSheetWithLegacyName_', 'SETTINGS_SHEET_NAME', 'LEGACY_SETTINGS_SHEET_NAME',
      'MARKETPLACES', 'marketplaceLabel_', 'marketplaceLabels_', 'findMarketplaceByLabel_',
      'SPAPI_HOST_EU', 'SPAPI_HOST_NA', 'CELLS']);

var runControl = loadGs('RunControl.gs',
    ['resolveChainStart_', 'normalizeChainStart_']);

/**
 * AsinCheck.gs — seules ses fonctions pures sont exercées ici : le découpage
 * des écritures et la lecture de l'état final de la boucle. Tout le reste du
 * fichier touche SpreadsheetApp, UrlFetchApp ou LockService.
 */
var asinCheck = loadGs(
    'AsinCheck.gs',
    ['unwrittenResults_', 'shouldFlush_', 'countRetries_', 'runEnd_', 'RESULT_FLUSH_SIZE',
      'RUN_END_DONE', 'RUN_END_TIMEOUT', 'RUN_END_STOPPED', 'RUN_END_FATAL',
      'freshResults_', 'countLabel_', 'runSummary_', 'buildContext_', 'runFatal_',
      'fatalMessage_', 'noMarketplaceMessage_', 'RUN_FATAL_MESSAGES', 'RUN_FATAL_SUFFIX'],
    { normalizeAsin_: asins.normalizeAsin_, CELLS: config.CELLS });

/**
 * EditTrigger.gs — seule la fonction pure est exercée : onEdit lui-même ne fait
 * que lire e.range et poser un clearContent.
 */
var editTrigger = loadGs(
    'EditTrigger.gs',
    ['staleResultsClearRange_'],
    {
      ASIN_SHEET_NAME: asins.ASIN_SHEET_NAME,
      ASIN_FIRST_DATA_ROW: asins.ASIN_FIRST_DATA_ROW,
      normalizeAsin_: asins.normalizeAsin_
    });

/**
 * Contexte de test : volontairement vide, aucun secret n'a sa place ici.
 * Seul l'hôte est renseigné — sans lui, restrictionsUrl_ construirait une URL
 * invalide et les appels « réseau » des tests échoueraient pour la mauvaise
 * raison.
 */
var DUMMY_CONTEXT = {
  accessToken: '',
  sellerId: '',
  marketplaceId: '',
  host: config.SPAPI_HOST_EU
};

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
// donc le résultat attendu est ERROR / NETWORK et non INVALID_ASIN.
var wellFormed = restrictions.checkAsin_('B0CHXMX9XC', DUMMY_CONTEXT);
check('un ASIN bien formé atteint l\'appel réseau', wellFormed.code, 'NETWORK');
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

// Sheets exprime la formule d'une règle relativement au coin haut-gauche de sa
// plage : un collage de cellules peut couper la nôtre, et le morceau qui
// commence en ligne 51 porte « =$B51="ELIGIBLE" ». S'il n'était pas reconnu, il
// ne serait jamais retiré et les règles s'empileraient à chaque passage.
styles.forEach(function (style) {
  check(style.status + ' : reconnu en ligne 2',
      formatting.isStatusFormatFormula_('=$B2="' + style.status + '"'), true);
  check(style.status + ' : reconnu en ligne 57 (plage découpée)',
      formatting.isStatusFormatFormula_('=$B57="' + style.status + '"'), true);
});

// Une règle posée à la main par le client ne doit jamais être retirée.
check('règle étrangère non reconnue', formatting.isStatusFormatFormula_('=$A2=""'), false);
check('règle sur une autre colonne non reconnue',
    formatting.isStatusFormatFormula_('=$C2="ELIGIBLE"'), false);
check('statut inconnu non reconnu',
    formatting.isStatusFormatFormula_('=$B2="AUTRE"'), false);
// Le motif est ancré : rien ne peut être accolé à la formule.
check('texte parasite en fin non reconnu',
    formatting.isStatusFormatFormula_('=$B2="ELIGIBLE"&"X"'), false);
check('texte parasite en tête non reconnu',
    formatting.isStatusFormatFormula_('=NOT($B2="ELIGIBLE")'), false);
check('sans numéro de ligne, non reconnu',
    formatting.isStatusFormatFormula_('=$B="ELIGIBLE"'), false);
check('formule vide non reconnue', formatting.isStatusFormatFormula_(''), false);

// La formule est écrite avec une lettre de colonne, la feuille lue avec un
// numéro : les deux doivent désigner la même colonne, celle du statut.
check('STATUS_FORMULA_COLUMN est la colonne du statut',
    formatting.STATUS_FORMULA_COLUMN.charCodeAt(0) - 'A'.charCodeAt(0) + 1,
    asins.ASIN_COLUMNS.status);

console.log('\n— Récap : formules générées, un séparateur par locale —');
var statusList = statuses.statusList_();

/**
 * Le séparateur d'arguments suit la locale du classeur : un Sheet français
 * renvoie #ERROR! sur une formule à virgules (bug constaté en test réel). Les
 * mêmes attentes sont donc vérifiées une fois par séparateur — une formule
 * qui en coderait un en dur ne pourrait pas passer les deux séries.
 */
function checkPlan(separator, expected) {
  var label = ' [« ' + separator + ' »]';
  var plan = summary.summaryPlan_(separator);
  var allFormulas = plan.statusLines
      .map(function (line) { return line.countFormula; })
      .concat(plan.statusLines.map(function (line) { return line.shareFormula; }))
      .concat(plan.totalLines.map(function (line) { return line.formula; }));

  check('une ligne par statut' + label, plan.statusLines.length, statusList.length);
  check('première ligne de statut en 4' + label, plan.statusLines[0].row, 4);
  check('lignes de statut consécutives' + label,
      plan.statusLines.filter(function (line, index) {
        return line.row !== plan.statusLines[0].row + index;
      }).length,
      0);
  check('les lignes suivent l\'ordre de statusList_' + label,
      plan.statusLines.map(function (line) { return line.status; }).join(','),
      statusList.join(','));
  check('toutes les formules commencent par =' + label,
      allFormulas.filter(function (formula) { return formula.charAt(0) !== '='; }).length, 0);

  // Aucune formule ne doit porter l'autre séparateur : c'est exactement le bug
  // (virgules écrites dans un classeur français).
  var other = separator === ',' ? ';' : ',';
  check('aucune formule avec « ' + other + " »" + label,
      allFormulas.filter(function (formula) { return formula.indexOf(other) !== -1; }).length, 0);

  check('COUNTIFS attendu pour ELIGIBLE' + label,
      plan.statusLines[0].countFormula, expected.count);
  check('part attendue pour ELIGIBLE' + label, plan.statusLines[0].shareFormula, expected.share);
  check('toutes les parts sont protégées' + label,
      plan.statusLines.filter(function (line) {
        return line.shareFormula.indexOf('=IFERROR(') !== 0;
      }).length,
      0);

  var totalLine = plan.totalLines[0];
  var pendingLine = plan.totalLines[1];
  var lastRunLine = plan.totalLines[2];
  check('total sous les statuts, après une ligne vide' + label,
      totalLine.row, plan.statusLines[plan.statusLines.length - 1].row + 2);
  // COUNTA n'a qu'un argument : seule formule du Récap sans séparateur, et la
  // seule qui marchait avant ce correctif.
  check('total attendu' + label, totalLine.formula, expected.total);
  check('à traiter attendu' + label, pendingLine.formula, expected.pending);
  check('dernier passage attendu' + label, lastRunLine.formula, expected.lastRun);
  check('dernier passage en dernière ligne' + label, lastRunLine.row, plan.lastRunRow);

  // ERROR est transitoire : il compte comme « à traiter », donc sa ligne ne doit
  // pas être soustraite du total. Statut définitif ajouté = soustraction à jour.
  var errorRow = plan.statusLines.filter(function (line) {
    return line.status === ASIN_STATUS.error;
  })[0].row;
  check('la ligne ERROR n\'est pas soustraite' + label,
      pendingLine.formula.indexOf('B' + errorRow + separator), -1);
  check('la ligne ERROR n\'est pas soustraite en fin de somme' + label,
      pendingLine.formula.indexOf('B' + errorRow + ')'), -1);
  check('autant de termes soustraits que de statuts définitifs' + label,
      pendingLine.formula.split(separator).length,
      statusList.filter(function (status) { return !asins.isPendingStatus_(status); }).length);
}

checkPlan(',', {
  count: '=COUNTIFS(\'ASINs\'!A2:A,"<>",\'ASINs\'!B2:B,"ELIGIBLE")',
  share: '=IFERROR(B4/$B$11,0)',
  total: '=COUNTA(\'ASINs\'!A2:A)',
  pending: '=$B$11-SUM(B4,B5,B6,B7,B8)',
  lastRun: '=IF(COUNT(\'ASINs\'!D2:D)=0,"",MAX(\'ASINs\'!D2:D))'
});
checkPlan(';', {
  count: '=COUNTIFS(\'ASINs\'!A2:A;"<>";\'ASINs\'!B2:B;"ELIGIBLE")',
  share: '=IFERROR(B4/$B$11;0)',
  total: '=COUNTA(\'ASINs\'!A2:A)',
  pending: '=$B$11-SUM(B4;B5;B6;B7;B8)',
  lastRun: '=IF(COUNT(\'ASINs\'!D2:D)=0;"";MAX(\'ASINs\'!D2:D))'
});

check('plage ASINs en-tête exclu', summary.asinRange_('A'), '\'ASINs\'!A2:A');

// La sonde doit porter le séparateur testé, et rien de traduit par Sheets :
// « TRUE » devient VRAI dans certaines locales, « SUM(1;1) » reste lisible.
check('deux séparateurs candidats', summary.FORMULA_SEPARATORS.join(''), ',;');
check('sonde avec virgule', summary.separatorProbeFormula_(','), '=SUM(1,1)');
check('sonde avec point-virgule', summary.separatorProbeFormula_(';'), '=SUM(1;1)');

console.log('\n— Sélection des lignes à traiter dans une chaîne —');
/**
 * Une chaîne de runs relance la vérification tranche par tranche. Un ERROR
 * écrit *pendant* la chaîne ne doit pas être retenté par la tranche suivante,
 * sinon la chaîne ne s'arrête jamais ; un ERROR antérieur à la chaîne doit
 * l'être, même atteint à la troisième tranche.
 */
var CHAIN_START = new Date('2026-11-10T12:00:00Z').getTime();
var OLD_DATE = new Date(CHAIN_START - 3600000);
var RECENT_DATE = new Date(CHAIN_START + 30000);

// Colonnes A:D, dans l'ordre de la feuille.
var SELECTION_ROWS = [
  ['B00000001X', '', '', ''],                                    // 2 : jamais vérifiée
  ['B00000002X', ASIN_STATUS.error, 'NETWORK', OLD_DATE],        // 3 : ERROR ancien
  ['B00000003X', ASIN_STATUS.error, 'NETWORK', RECENT_DATE],     // 4 : ERROR de la chaîne
  ['B00000004X', ASIN_STATUS.eligible, '', OLD_DATE],            // 5 : définitif
  ['B00000005X', ASIN_STATUS.error, 'NETWORK', ''],              // 6 : ERROR sans date
  ['', '', '', ''],                                              // 7 : pas d'ASIN
  ['B00000006X', ASIN_STATUS.notFound, 'ASIN_NOT_FOUND', OLD_DATE]  // 8 : définitif
];

var selection = asins.selectPendingRows_(SELECTION_ROWS, 2, CHAIN_START);
var selectedRows = selection.rows.map(function (row) { return row.row; });

check('lignes retenues', selectedRows.join(','), '2,3,6');
check('ligne vide (B vide) retenue', selectedRows.indexOf(2) !== -1, true);
check('ERROR ancien retenu', selectedRows.indexOf(3) !== -1, true);
check('ERROR de la chaîne écarté', selectedRows.indexOf(4), -1);
check('statut définitif écarté (ELIGIBLE)', selectedRows.indexOf(5), -1);
check('statut définitif écarté (NOT_FOUND)', selectedRows.indexOf(8), -1);
check('ERROR sans date retenu', selectedRows.indexOf(6) !== -1, true);
check('ligne sans ASIN écartée', selectedRows.indexOf(7), -1);
check('ERROR sans date compté', selection.undatedRetries, 1);
check('isRetry faux sur une ligne jamais vérifiée',
    selection.rows[0].isRetry, false);
check('isRetry vrai sur un ERROR', selection.rows[1].isRetry, true);
check('ASIN normalisé pour la requête', selection.rows[0].asin, 'B00000001X');

// Une date illisible est traitée comme ancienne : mieux vaut une requête de
// trop qu'un ERROR jamais repris.
check('date texte traitée comme illisible',
    asins.checkedAtMillis_('10/11/2026 12:00'), null);
check('date vide traitée comme illisible', asins.checkedAtMillis_(''), null);
check('vraie date lue', asins.checkedAtMillis_(OLD_DATE), OLD_DATE.getTime());

// Même liste, chaîne démarrée plus tard : l'ERROR récent redevient ancien.
var laterSelection = asins.selectPendingRows_(
    SELECTION_ROWS, 2, RECENT_DATE.getTime() + 1000);
check('une nouvelle chaîne reprend l\'ERROR de la précédente',
    laterSelection.rows.map(function (row) { return row.row; }).join(','), '2,3,4,6');

// La colonne A n'est jamais réécrite, mais la requête part en majuscules.
var messyRows = [['  b0chxmx9xc  ', '', '', '']];
check('ASIN en minuscules et espacé',
    asins.selectPendingRows_(messyRows, 2, CHAIN_START).rows[0].asin, 'B0CHXMX9XC');

console.log('\n— chainStart : fixé par le serveur, stable sur toute la chaîne —');
/**
 * Le serveur fixe chainStart au premier appel et le rend au panneau, qui le
 * repasse tel quel. Laisser chaque tranche repartir de l'horloge du navigateur
 * faisait avancer la valeur de tranche en tranche : les ERROR écrits par les
 * tranches précédentes redevenaient « anciens » et étaient retentés sans fin.
 */
check('nouvelle chaîne : l\'horloge du serveur fait foi',
    runControl.resolveChainStart_({ newChain: true }, CHAIN_START), CHAIN_START);
// La valeur envoyée par le client est ignorée sur newChain, même plausible.
check('nouvelle chaîne : valeur client ignorée',
    runControl.resolveChainStart_(
        { newChain: true, chainStart: CHAIN_START - 600000 }, CHAIN_START),
    CHAIN_START);
check('tranche suivante : valeur reçue inchangée',
    runControl.resolveChainStart_({ chainStart: CHAIN_START }, CHAIN_START + 300000),
    CHAIN_START);
check('tranche suivante : valeur future ramenée à maintenant',
    runControl.resolveChainStart_({ chainStart: CHAIN_START + 600000 }, CHAIN_START),
    CHAIN_START);
check('tranche suivante : valeur illisible → maintenant',
    runControl.resolveChainStart_({ chainStart: 'bientôt' }, CHAIN_START), CHAIN_START);
check('tranche suivante : valeur absente → maintenant',
    runControl.resolveChainStart_({}, CHAIN_START), CHAIN_START);
check('options absentes → maintenant',
    runControl.resolveChainStart_(null, CHAIN_START), CHAIN_START);

// Non-régression du bug : quatre tranches, horloge serveur qui avance, valeur
// renvoyée au serveur telle qu'il l'a rendue. Elle ne doit jamais bouger.
var chained = runControl.resolveChainStart_({ newChain: true }, CHAIN_START);
[60000, 180000, 300000].forEach(function (elapsed) {
  chained = runControl.resolveChainStart_({ chainStart: chained }, CHAIN_START + elapsed);
  check('chainStart stable après ' + (elapsed / 60000) + ' min de chaîne',
      chained, CHAIN_START);
});

// Filet de sécurité conservé sous resolveChainStart_.
check('filet : valeur future ramenée',
    runControl.normalizeChainStart_(CHAIN_START + 600000, CHAIN_START), CHAIN_START);
check('filet : valeur passée conservée',
    runControl.normalizeChainStart_(CHAIN_START - 600000, CHAIN_START), CHAIN_START - 600000);
check('filet : zéro → maintenant',
    runControl.normalizeChainStart_(0, CHAIN_START), CHAIN_START);

console.log('\n— Compteurs du panneau —');
var counters = asins.countStatuses_(SELECTION_ROWS.map(function (row) {
  return [row[0], row[1]];
}));
check('total = lignes portant un ASIN', counters.total, 6);
// « À traiter » ignore chainStart : c'est le travail restant affiché, la même
// définition que « À traiter » du Récap.
check('à traiter = vides + tous les ERROR', counters.pending, 4);
check('ELIGIBLE compté', counters.counts[ASIN_STATUS.eligible], 1);
check('ERROR compté', counters.counts[ASIN_STATUS.error], 3);
check('NOT_FOUND compté', counters.counts[ASIN_STATUS.notFound], 1);
check('APPROVAL_REQUIRED à zéro', counters.counts[ASIN_STATUS.approvalRequired], 0);
check('tous les statuts présents dans les compteurs',
    Object.keys(counters.counts).sort().join(','),
    statusList.slice().sort().join(','));
check('feuille vide → total 0', asins.countStatuses_([]).total, 0);
check('feuille vide → à traiter 0', asins.countStatuses_([]).pending, 0);

console.log('\n— Écriture des résultats par paquets —');
/**
 * Les résultats sont écrits pendant la boucle, et non seulement à la fin :
 * sinon les compteurs du panneau restent figés jusqu'à 4 min 30. Le compteur de
 * lignes écrites est ce qui empêche le finally de réécrire un paquet déjà posé.
 */
function fakeResults(count) {
  var results = [];
  for (var i = 0; i < count; i++) {
    results.push({ row: 2 + i, isRetry: false });
  }
  return results;
}

check('paquet plein déclenche une écriture', asinCheck.shouldFlush_(20, 20), true);
check('paquet incomplet n\'écrit pas', asinCheck.shouldFlush_(19, 20), false);
check('rien à écrire', asinCheck.shouldFlush_(0, 20), false);
// Un paquet peut dépasser la taille si une itération en ajoute plusieurs.
check('paquet dépassé écrit quand même', asinCheck.shouldFlush_(21, 20), true);
// Garde-fou : une taille nulle ferait écrire à chaque tour, voire boucler.
check('taille nulle n\'écrit jamais', asinCheck.shouldFlush_(5, 0), false);
check('taille par défaut raisonnable', asinCheck.RESULT_FLUSH_SIZE > 0, true);

check('aucun résultat → rien à écrire',
    asinCheck.unwrittenResults_([], 0).length, 0);
check('rien encore écrit → tout le paquet',
    asinCheck.unwrittenResults_(fakeResults(20), 0).length, 20);
check('premier paquet écrit → reste vide',
    asinCheck.unwrittenResults_(fakeResults(20), 20).length, 0);
check('reste final après deux paquets',
    asinCheck.unwrittenResults_(fakeResults(47), 40).length, 7);
check('le reste commence après la dernière ligne écrite',
    asinCheck.unwrittenResults_(fakeResults(47), 40)[0].row, 42);
// Non-régression de la double écriture : chaque ligne n'est posée qu'une fois.
var allResults = fakeResults(47);
var writtenRows = [];
var writtenCount = 0;
[20, 40, 47].forEach(function (upTo) {
  asinCheck.unwrittenResults_(allResults.slice(0, upTo), writtenCount)
      .forEach(function (result) { writtenRows.push(result.row); });
  writtenCount = upTo;
});
check('47 lignes écrites, aucune deux fois', writtenRows.length, 47);
check('aucune ligne écrite deux fois',
    writtenRows.filter(function (row, index) {
      return writtenRows.indexOf(row) !== index;
    }).length,
    0);
check('les lignes écrites couvrent toute la tranche',
    writtenRows.join(','),
    allResults.map(function (result) { return result.row; }).join(','));

console.log('\n— Fin de tranche : ce que le panneau lit pour enchaîner —');
// Seul « timeout » relance une tranche ; fatal et stopped priment sur lui.
check('fatal prime sur le reste',
    asinCheck.runEnd_({ fatal: { httpCode: 400 }, stopped: true }, 5),
    asinCheck.RUN_END_FATAL);
check('arrêt demandé',
    asinCheck.runEnd_({ fatal: null, stopped: true }, 5), asinCheck.RUN_END_STOPPED);
check('budget épuisé, des lignes restent',
    asinCheck.runEnd_({ fatal: null, stopped: false }, 5), asinCheck.RUN_END_TIMEOUT);
check('plus rien à faire',
    asinCheck.runEnd_({ fatal: null, stopped: false }, 0), asinCheck.RUN_END_DONE);
check('relances comptées',
    asinCheck.countRetries_([{ isRetry: true }, { isRetry: false }, { isRetry: true }]), 2);

console.log('\n— Édition de la colonne A : effacement du résultat périmé —');
/**
 * Une ligne vérifiée dont l'ASIN change garderait sinon un statut définitif —
 * donc jamais réinterrogé — à côté du nouvel ASIN. staleResultsClearRange_
 * décide quelles lignes de B:D effacer pour une édition donnée.
 */
function editOf(overrides) {
  var edit = {
    sheetName: asins.ASIN_SHEET_NAME,
    row: 2,
    column: 1,
    numRows: 1,
    numColumns: 1,
    value: 'B00000001X',
    oldValue: 'B00000009X'
  };
  Object.keys(overrides).forEach(function (key) {
    edit[key] = overrides[key];
  });
  return edit;
}

function clearRangeOf(overrides) {
  return JSON.stringify(editTrigger.staleResultsClearRange_(editOf(overrides)));
}

check('autre onglet : rien', clearRangeOf({ sheetName: 'Settings' }), 'null');
check('édition en colonne B : rien', clearRangeOf({ column: 2 }), 'null');
check('édition en colonne D : rien', clearRangeOf({ column: 4 }), 'null');
check('A2, nouvel ASIN : une ligne effacée',
    clearRangeOf({}), '{"firstRow":2,"numRows":1}');
check('collage A2:A5 : quatre lignes effacées',
    clearRangeOf({ numRows: 4, value: undefined, oldValue: undefined }),
    '{"firstRow":2,"numRows":4}');
check('collage A3:D4 : les deux lignes effacées malgré les colonnes B:D collées',
    clearRangeOf({ row: 3, numRows: 2, numColumns: 4, value: undefined, oldValue: undefined }),
    '{"firstRow":3,"numRows":2}');
check('plage couvrant l\'en-tête (A1:A3) : tronquée aux lignes de données',
    clearRangeOf({ row: 1, numRows: 3, value: undefined, oldValue: undefined }),
    '{"firstRow":2,"numRows":2}');
check('en-tête seul (A1) : rien', clearRangeOf({ row: 1, oldValue: undefined }), 'null');
// Retaper la même valeur — même en minuscules espacées — ne change pas l'ASIN
// interrogé : le résultat reste valable, rien n'est effacé.
check('même valeur retapée : rien',
    clearRangeOf({ value: 'B00000009X' }), 'null');
check('même valeur à la normalisation près : rien',
    clearRangeOf({ value: '  b00000009x  ' }), 'null');
// Hors du cas mono-cellule avec les deux valeurs connues, on efface toujours.
check('oldValue absent (collage) : effacé par prudence',
    clearRangeOf({ oldValue: undefined }), '{"firstRow":2,"numRows":1}');
check('value absent (suppression) : effacé',
    clearRangeOf({ value: undefined }), '{"firstRow":2,"numRows":1}');
check('multi-cellules : le test de valeur inchangée ne s\'applique pas',
    clearRangeOf({ numRows: 2, value: 'B00000009X' }), '{"firstRow":2,"numRows":2}');

console.log('\n— Garde à l\'écriture : la colonne A fait foi au flush —');
/**
 * onEdit ne prend pas le verrou : si l'utilisateur change un ASIN pendant un
 * run, la ligne pending recevrait le résultat de l'ancien ASIN au flush
 * suivant. freshResults_ relit la colonne A et écarte ces résultats — la ligne
 * reste vide et sera reprise au run suivant avec le bon ASIN.
 */
var FLUSH_BATCH = [
  { row: 2, asin: 'B00000001X' },
  { row: 3, asin: 'B00000002X' },
  { row: 4, asin: 'B00000003X' }
];
var freshKept = asinCheck.freshResults_(FLUSH_BATCH, {
  2: 'B00000001X',
  3: 'B0CHANGEDX',
  4: '  b00000003x  '
});
check('ASIN intact : écrit', freshKept[0].row, 2);
check('ASIN remplacé pendant le run : écarté',
    freshKept.map(function (result) { return result.row; }).indexOf(3), -1);
check('ASIN inchangé mais ressaisi en minuscules : écrit',
    freshKept[freshKept.length - 1].row, 4);
check('cellule A vidée pendant le run : écartée',
    asinCheck.freshResults_([{ row: 2, asin: 'B00000001X' }], { 2: '' }).length, 0);
check('paquet intact : tout passe',
    asinCheck.freshResults_(FLUSH_BATCH, {
      2: 'B00000001X', 3: 'B00000002X', 4: 'B00000003X'
    }).length, 3);
// La garde compare la feuille normalisée à result.asin tel quel : ce test
// prouve que selectPendingRows_ rend bien l'ASIN sous la forme normalizeAsin_,
// sans quoi freshResults_ écarterait toutes les lignes mal saisies.
var messyPending = asins.selectPendingRows_([['  b0chxmx9xc  ', '', '', '']], 2, CHAIN_START);
check('result.asin sort de selectPendingRows_ déjà normalisé',
    asinCheck.freshResults_(
        [{ row: 2, asin: messyPending.rows[0].asin }],
        { 2: '  b0chxmx9xc  ' }).length,
    1);

console.log('\n— Pluriels des bilans : « 1 ASIN checked », jamais « 1 ASINs » —');
check('zéro : pluriel', asinCheck.countLabel_(0, 'ASIN'), '0 ASINs');
check('un : singulier', asinCheck.countLabel_(1, 'ASIN'), '1 ASIN');
check('deux : pluriel', asinCheck.countLabel_(2, 'ASIN'), '2 ASINs');

// runSummary_ assemble le bilan du serveur : vérifié mot pour mot.
check('bilan d\'un seul ASIN',
    asinCheck.runSummary_([{ isRetry: false }], 0, 0, asinCheck.RUN_END_DONE),
    '1 ASIN checked.');
check('bilan de plusieurs ASINs',
    asinCheck.runSummary_(
        [{ isRetry: false }, { isRetry: false }, { isRetry: false }],
        0, 0, asinCheck.RUN_END_DONE),
    '3 ASINs checked.');
check('bilan avec relances',
    asinCheck.runSummary_(
        [{ isRetry: true }, { isRetry: false }], 0, 0, asinCheck.RUN_END_DONE),
    '2 ASINs checked: 1 new, 1 retried after ERROR.');
check('une seule ligne ERROR sans date : singulier',
    asinCheck.runSummary_([{ isRetry: false }], 0, 1, asinCheck.RUN_END_DONE),
    '1 ASIN checked. 1 ERROR row without a readable date in column D, ' +
        'retried as a precaution.');
check('bilan d\'un arrêt demandé',
    asinCheck.runSummary_([{ isRetry: false }], 3, 0, asinCheck.RUN_END_STOPPED),
    'Stop requested. 1 ASIN checked. 3 remaining.');

console.log('\n— Marketplaces : table unique, régions et hôtes —');
/**
 * MARKETPLACES porte l'ID, la région et l'hôte SP-API : c'est la source unique
 * depuis l'ajout de l'Amérique du Nord, et l'hôte n'est plus une constante
 * globale du script.
 *
 * Les six marchés EU doivent rester en tête, dans l'ordre et avec le même ID :
 * le libellé construit depuis cette table est la valeur écrite dans la cellule
 * B5 des classeurs clients, et la liste déroulante stricte refuserait une valeur
 * qui n'y figurerait plus.
 */
var marketplaces = config.MARKETPLACES;

function marketplaceField(list, field) {
  return list.map(function (marketplace) {
    return marketplace[field];
  }).join(',');
}

function distinctCount(values) {
  return values.filter(function (value, index) {
    return values.indexOf(value) === index;
  }).length;
}

check('neuf marketplaces', marketplaces.length, 9);
check('les six marchés EU restent en tête, dans l\'ordre',
    marketplaceField(marketplaces.slice(0, 6), 'code'), 'FR,DE,ES,IT,UK,NL');
check('les trois marchés NA viennent ensuite',
    marketplaceField(marketplaces.slice(6), 'code'), 'US,CA,MX');
check('IDs des marchés EU inchangés',
    marketplaceField(marketplaces.slice(0, 6), 'marketplaceId'),
    'A13V1IB3VIYZZH,A1PA6795UKMFR9,A1RKKUPIHCS9HS,APJ6JRA9NG5V4,A1F83G8C2ARO7P,A1805IZSGTT6HS');
check('IDs des marchés NA',
    marketplaceField(marketplaces.slice(6), 'marketplaceId'),
    'ATVPDKIKX0DER,A2EUQ1WTGCTBG2,A1AM78C64UM0Y8');
check('codes distincts', distinctCount(marketplaces.map(function (marketplace) {
  return marketplace.code;
})), 9);
check('IDs distincts', distinctCount(marketplaces.map(function (marketplace) {
  return marketplace.marketplaceId;
})), 9);
// Attrape un copier-coller abîmé : un ID n'est que des majuscules et des chiffres.
check('les IDs ne contiennent que des majuscules et des chiffres',
    marketplaces.filter(function (marketplace) {
      return /^[A-Z0-9]+$/.test(marketplace.marketplaceId);
    }).length, 9);
check('chaque entrée a une région EU ou NA',
    marketplaces.filter(function (marketplace) {
      return marketplace.region === 'EU' || marketplace.region === 'NA';
    }).length, 9);
// Croisé avec les constantes, et non avec des littéraux recopiés ici.
check('chaque marché porte l\'hôte de sa région',
    marketplaces.filter(function (marketplace) {
      return marketplace.host ===
          (marketplace.region === 'EU' ? config.SPAPI_HOST_EU : config.SPAPI_HOST_NA);
    }).length, 9);
// Non-régression du cahier des charges : l'hôte EU ne bouge pas d'un caractère.
check('hôte EU inchangé', config.SPAPI_HOST_EU, 'https://sellingpartnerapi-eu.amazon.com');
check('hôte NA', config.SPAPI_HOST_NA, 'https://sellingpartnerapi-na.amazon.com');

/**
 * Format du libellé : c'est un contrat avec les classeurs déjà distribués.
 * findMarketplaceByLabel_ compare par égalité stricte, donc le moindre
 * changement ici rendrait la cellule B5 illisible chez tous les clients — et la
 * validation stricte les empêcherait de la ressaisir.
 */
check('format du libellé gelé',
    config.marketplaceLabel_({ code: 'FR', marketplaceId: 'A13V1IB3VIYZZH' }),
    'FR — A13V1IB3VIYZZH');
check('format du libellé identique pour un marché NA',
    config.marketplaceLabel_({ code: 'US', marketplaceId: 'ATVPDKIKX0DER' }),
    'US — ATVPDKIKX0DER');
check('neuf entrées dans la liste déroulante', config.marketplaceLabels_().length, 9);
// Un libellé en double ferait rendre null à findMarketplaceByLabel_ (matches.length === 1).
check('libellés sans doublon', distinctCount(config.marketplaceLabels_()), 9);

var foundFr = config.findMarketplaceByLabel_('FR — A13V1IB3VIYZZH');
check('libellé EU → entrée FR', foundFr.code, 'FR');
check('libellé EU → région EU', foundFr.region, 'EU');
check('libellé EU → hôte EU', foundFr.host, config.SPAPI_HOST_EU);
var foundUs = config.findMarketplaceByLabel_('US — ATVPDKIKX0DER');
check('libellé NA → entrée US', foundUs.code, 'US');
check('libellé NA → région NA', foundUs.region, 'NA');
check('libellé NA → hôte NA', foundUs.host, config.SPAPI_HOST_NA);
check('libellé inconnu → null',
    config.findMarketplaceByLabel_('ZZ — A000000000000'), null);
check('cellule vide → null', config.findMarketplaceByLabel_(''), null);
// Tiret simple au lieu du cadratin, puis casse différente : la comparaison est
// stricte, et ces deux assertions figent le fait qu'elle l'est.
check('tiret simple → null', config.findMarketplaceByLabel_('FR - A13V1IB3VIYZZH'), null);
check('casse différente → null', config.findMarketplaceByLabel_('fr — A13V1IB3VIYZZH'), null);
check('aller-retour libellé → entrée, sur les neuf marchés',
    marketplaces.filter(function (marketplace) {
      return config.findMarketplaceByLabel_(config.marketplaceLabel_(marketplace)) ===
          marketplace;
    }).length, 9);

console.log('\n— URL SP-API : l\'hôte vient du contexte —');
/**
 * L'assertion centrale de l'ajout de l'Amérique du Nord.
 *
 * Sans elle, un host absent du contexte passerait inaperçu : l'URL est
 * construite dans le try de fetchRestrictions_, donc l'exception serait traduite
 * en ERROR / NETWORK sur chaque ligne du run, indistinguable d'une panne réseau.
 */
function urlForMarketplace(marketplace, sellerId) {
  return restrictions.restrictionsUrl_('B0CHXMX9XC', {
    accessToken: '',
    sellerId: sellerId,
    marketplaceId: marketplace.marketplaceId,
    host: marketplace.host
  });
}

var euUrl = urlForMarketplace(foundFr, 'A1SELLER');
var naUrl = urlForMarketplace(foundUs, 'A1SELLER');
check('marché EU → hôte EU', euUrl.indexOf(config.SPAPI_HOST_EU + '/listings/'), 0);
check('marché NA → hôte NA', naUrl.indexOf(config.SPAPI_HOST_NA + '/listings/'), 0);
check('marché EU → marketplaceId FR dans l\'URL',
    euUrl.indexOf('marketplaceIds=A13V1IB3VIYZZH') !== -1, true);
check('marché NA → marketplaceId US dans l\'URL',
    naUrl.indexOf('marketplaceIds=ATVPDKIKX0DER') !== -1, true);
check('les trois paramètres de requête sont là',
    euUrl.indexOf('?asin=B0CHXMX9XC&sellerId=A1SELLER&marketplaceIds=') !== -1, true);
// Le encodeURIComponent du sellerId n'était couvert par aucun test.
check('le sellerId est encodé',
    urlForMarketplace(foundFr, 'A1 &B').indexOf('sellerId=A1%20%26B&') !== -1, true);

console.log('\n— Contexte du run : l\'hôte et la région y entrent, rien d\'autre —');
/**
 * buildContext_ est devenue pure : la marketplace et le Seller ID sont lus par
 * runAsinCheck_ sous le verrou, puis passés en paramètres. C'est ce qui rend
 * vérifiable ici que le contexte porte bien un hôte — un `host` oublié ne se
 * verrait sinon qu'à l'exécution réelle, sous la forme d'un run entier en
 * ERROR / NETWORK, indistinguable d'une panne réseau.
 */
var DUMMY_TOKEN = { ok: true, accessToken: '' };
var naContext = asinCheck.buildContext_(DUMMY_TOKEN, foundUs, 'A1SELLER');
var euContext = asinCheck.buildContext_(DUMMY_TOKEN, foundFr, 'A1SELLER');

check('le contexte porte l\'hôte du marché', naContext.host, config.SPAPI_HOST_NA);
check('un marché EU donne l\'hôte EU', euContext.host, config.SPAPI_HOST_EU);
check('le contexte porte le marketplaceId', naContext.marketplaceId, 'ATVPDKIKX0DER');
check('le contexte porte le code du marché', naContext.code, 'US');
check('le contexte porte la région', naContext.region, 'NA');
check('le contexte porte le Seller ID reçu', naContext.sellerId, 'A1SELLER');
// Six champs, pas un de plus : rien qui vienne d'une réponse Amazon.
check('le contexte n\'a aucun autre champ',
    Object.keys(naContext).sort().join(','),
    'accessToken,code,host,marketplaceId,region,sellerId');

/**
 * B5 vidée entre validateSettings_ (lu hors verrou) et la construction du
 * contexte : runAsinCheck_ rend un fatal « Configuration incomplete » au lieu de
 * laisser lever. Les deux assertions prouvent les deux moitiés du garde-fou —
 * le message rendu, et le TypeError qu'il évite.
 */
check('marketplace nulle → message Configuration incomplete',
    asinCheck.noMarketplaceMessage_(),
    'Configuration incomplete: marketplace is empty or not in the list ' +
        '(Settings tab, cell B5).');
check('le message cite la cellule de la constante CELLS',
    asinCheck.noMarketplaceMessage_().indexOf('cell ' + config.CELLS.marketplace + ')') !== -1,
    true);
var threwOnNullMarketplace = false;
try {
  asinCheck.buildContext_(DUMMY_TOKEN, null, '');
} catch (error) {
  threwOnNullMarketplace = true;
}
check('sans ce garde-fou, buildContext_ lèverait sur une marketplace nulle',
    threwOnNullMarketplace, true);

console.log('\n— Message d\'arrêt : piste région, sans rien d\'Amazon —');
/**
 * Le mismatch de région n'est pas détectable : rien ne stocke la région des
 * clés, et le corps de réponse n'est jamais lu. Nommer le marché choisi est donc
 * tout ce que le message peut offrir, et ce marché sort de MARKETPLACES.
 */
var fatal400 = asinCheck.runFatal_(400, naContext);
check('le signal d\'arrêt ne retient que trois champs',
    Object.keys(fatal400).sort().join(','), 'httpCode,marketplaceCode,region');
check('le signal d\'arrêt ne porte pas le jeton', fatal400.accessToken, undefined);

var message400 = asinCheck.fatalMessage_(fatal400);
check('400 : la piste région nomme le marché, mot pour mot',
    message400.indexOf('\n\nSelected marketplace: US (North America endpoint). Check that ' +
        'the Seller ID and the refresh_token belong to the same region as this ' +
        'marketplace.') !== -1,
    true);
check('400 : le texte de l\'allowlist ouvre le message',
    message400.indexOf(asinCheck.RUN_FATAL_MESSAGES[400]), 0);
check('400 : le rappel de reprise ferme le message',
    message400.indexOf(asinCheck.RUN_FATAL_SUFFIX) + asinCheck.RUN_FATAL_SUFFIX.length,
    message400.length);
check('403 : piste région sur un marché EU',
    asinCheck.fatalMessage_(asinCheck.runFatal_(403, euContext))
        .indexOf('Selected marketplace: FR (Europe endpoint).') !== -1,
    true);
// 401 : c'est le jeton qui est en cause, pas la région, et une tentative avec un
// jeton frais a déjà eu lieu. La piste ne doit pas apparaître.
check('401 : aucune piste région',
    asinCheck.fatalMessage_(asinCheck.runFatal_(401, naContext)),
    asinCheck.RUN_FATAL_MESSAGES[401] + asinCheck.RUN_FATAL_SUFFIX);
// Repli : dès qu'une information manque, texte générique. Un message mal formé
// serait pire que pas de piste du tout.
check('région inconnue → aucune piste',
    asinCheck.fatalMessage_({ httpCode: 400, marketplaceCode: 'US', region: 'ZZ' }),
    asinCheck.RUN_FATAL_MESSAGES[400] + asinCheck.RUN_FATAL_SUFFIX);
check('marché absent → aucune piste',
    asinCheck.fatalMessage_({ httpCode: 403, marketplaceCode: '', region: 'NA' }),
    asinCheck.RUN_FATAL_MESSAGES[403] + asinCheck.RUN_FATAL_SUFFIX);
check('code hors allowlist → texte générique, sans piste',
    asinCheck.fatalMessage_({ httpCode: 500, marketplaceCode: 'US', region: 'NA' }),
    'Amazon refused the request (HTTP 500).' + asinCheck.RUN_FATAL_SUFFIX);
check('le message affiché est 100 % ASCII',
    /^[\x20-\x7E\n]*$/.test(message400), true);

console.log('\n— Onglets : résolution du nom français laissé par la version FR —');
/**
 * L'interface est passée en anglais, mais un classeur créé par la version
 * française porte encore « Paramètres » et « Récap ». Sans cette résolution,
 * getSheetByName() échouerait et un onglet vide serait inséré à côté : le
 * Seller ID et la marketplace, qui vivent dans la feuille et non dans les
 * propriétés, resteraient sur un onglet orphelin.
 *
 * Faux classeur : seuls getSheetByName et setName sont utilisés, et setName est
 * enregistré pour vérifier qu'un renommage a bien eu lieu — ou n'a pas eu lieu.
 */
function fakeSpreadsheet(names) {
  var sheets = {};
  names.forEach(function (name) {
    sheets[name] = {
      name: name,
      renamedTo: null,
      setName: function (newName) {
        this.renamedTo = newName;
        sheets[newName] = this;
      }
    };
  });
  return {
    sheets: sheets,
    getSheetByName: function (name) {
      return sheets[name] || null;
    }
  };
}

var englishOnly = fakeSpreadsheet(['Settings']);
check('onglet anglais trouvé directement',
    config.findSheetWithLegacyName_(englishOnly, 'Settings', 'Paramètres'),
    englishOnly.sheets['Settings']);
check('onglet anglais : aucun renommage',
    englishOnly.sheets['Settings'].renamedTo, null);

// Le cas de la migration : l'onglet français est retrouvé puis renommé en place,
// donc tout ce que l'utilisateur y a saisi reste là où il est.
var legacyOnly = fakeSpreadsheet(['Paramètres']);
var resolved = config.findSheetWithLegacyName_(legacyOnly, 'Settings', 'Paramètres');
check('onglet français retrouvé', resolved, legacyOnly.sheets['Paramètres']);
check('onglet français renommé en place', resolved.renamedTo, 'Settings');

// Aucun des deux noms : l'appelant insère un onglet neuf.
check('aucun onglet → null',
    config.findSheetWithLegacyName_(fakeSpreadsheet([]), 'Settings', 'Paramètres'), null);

/**
 * Les deux onglets présents : setName() lèverait sur une collision de noms, et
 * un onglet de l'utilisateur ne doit jamais être supprimé par le script. On
 * garde donc l'anglais et on laisse le français intact.
 */
var both = fakeSpreadsheet(['Settings', 'Paramètres']);
check('les deux présents : l\'anglais gagne',
    config.findSheetWithLegacyName_(both, 'Settings', 'Paramètres'),
    both.sheets['Settings']);
check('les deux présents : le français n\'est pas renommé',
    both.sheets['Paramètres'].renamedTo, null);

// Les noms viennent des constantes, pas de littéraux recopiés ici.
check('constantes du nom de l\'onglet Settings',
    config.SETTINGS_SHEET_NAME + '/' + config.LEGACY_SETTINGS_SHEET_NAME,
    'Settings/Paramètres');
check('constantes du nom de l\'onglet Summary',
    summary.SUMMARY_SHEET_NAME + '/' + summary.LEGACY_SUMMARY_SHEET_NAME,
    'Summary/Récap');

console.log('\n— Interface en anglais : aucun texte français hors commentaires —');
/**
 * Garde-fou contre une traduction laissée à moitié : plus aucune lettre accentuée
 * ne doit apparaître dans du code, seulement dans les commentaires (qui restent
 * en français, par convention du projet).
 *
 * Le test porte sur les **lettres** latines accentuées, et non sur tout
 * non-ASCII : « — », « … » et « → » sont de la ponctuation anglaise légitime, et
 * les libellés affichés s'en servent.
 *
 * Seule exception admise : les deux noms d'onglets de la version française, que
 * findSheetWithLegacyName_ doit forcément citer pour les retrouver.
 */
var ACCENTED_LETTER = /[À-ɏ]/;
var LEGACY_NAME_LINE = /LEGACY_(SETTINGS|SUMMARY)_SHEET_NAME =/;

/** Une ligne de commentaire pur : les textes affichés n'y vivent jamais. */
function isCommentLine(line) {
  var trimmed = line.trim();
  return trimmed.indexOf('//') === 0 || trimmed.indexOf('*') === 0 ||
      trimmed.indexOf('/*') === 0;
}

var accentedLines = [];
fs.readdirSync(SRC_DIR)
    .filter(function (fileName) {
      return /\.(gs|html)$/.test(fileName);
    })
    .forEach(function (fileName) {
      fs.readFileSync(path.join(SRC_DIR, fileName), 'utf8')
          .split('\n')
          .forEach(function (line, index) {
            if (isCommentLine(line) || LEGACY_NAME_LINE.test(line)) {
              return;
            }
            if (ACCENTED_LETTER.test(line)) {
              accentedLines.push(fileName + ':' + (index + 1) + ' ' + line.trim());
            }
          });
    });

check('aucune lettre accentuée hors commentaires',
    accentedLines.join(' | '), '');
// Le garde-fou ne vaut que s'il voit bien les deux exceptions qu'il écarte.
check('le garde-fou reconnaît les deux noms d\'onglets français',
    ['var LEGACY_SETTINGS_SHEET_NAME = \'Paramètres\';',
      'var LEGACY_SUMMARY_SHEET_NAME = \'Récap\';']
        .filter(function (line) { return LEGACY_NAME_LINE.test(line); }).length,
    2);

console.log('\n' + (checks - failures) + '/' + checks + ' conformes');
if (failures > 0) {
  console.log(failures + ' échec(s)');
}
process.exitCode = failures > 0 ? 1 : 0;
