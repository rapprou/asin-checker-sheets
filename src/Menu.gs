/**
 * Menu.gs — construction du menu « ASIN Checker ».
 *
 * onOpen n'écrit rien dans le classeur : un déclencheur simple tourne avec une
 * autorisation limitée et l'ouverture du Sheet doit rester instantanée.
 * Les onglets « Settings » et « ASINs » sont créés à la demande par les
 * actions du menu.
 */

/** Un groupe par bloc d'entrées ; un séparateur est inséré entre les groupes. */
var MENU_GROUPS = [
  [
    { caption: 'Enter / edit keys', functionName: 'showKeysDialog' },
    { caption: 'Test connection', functionName: 'testConnection' },
    { caption: 'Clear keys', functionName: 'clearKeys' }
  ],
  [
    { caption: 'Check ASINs', functionName: 'checkAsins' },
    { caption: 'Clear results', functionName: 'clearAsinResults' }
  ],
  [
    { caption: 'Open panel', functionName: 'showSidebar' },
    { caption: 'Apply colors', functionName: 'applyStatusFormatting' },
    { caption: 'Create / repair Summary', functionName: 'ensureSummarySheet' }
  ]
];

/** Déclencheur simple : ajoute le menu à l'ouverture du classeur. */
function onOpen() {
  // APP_NAME est lu ici, et non au chargement du fichier : les constantes
  // partagées entre fichiers .gs ne sont fiables qu'à l'exécution.
  var menu = SpreadsheetApp.getUi().createMenu(APP_NAME);
  MENU_GROUPS.forEach(function (group, index) {
    if (index > 0) {
      menu.addSeparator();
    }
    group.forEach(function (item) {
      menu.addItem(item.caption, item.functionName);
    });
  });
  menu.addToUi();
}
