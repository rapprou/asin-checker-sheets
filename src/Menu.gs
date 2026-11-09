/**
 * Menu.gs — construction du menu « ASIN Checker ».
 *
 * onOpen n'écrit rien dans le classeur : un déclencheur simple tourne avec une
 * autorisation limitée et l'ouverture du Sheet doit rester instantanée.
 * L'onglet « Paramètres » est créé à la demande par les actions du menu.
 */

var MENU_ITEMS = [
  { caption: 'Saisir / modifier les clés', functionName: 'showKeysDialog' },
  { caption: 'Tester la connexion', functionName: 'testConnection' },
  { caption: 'Effacer les clés', functionName: 'clearKeys' }
];

/** Déclencheur simple : ajoute le menu à l'ouverture du classeur. */
function onOpen() {
  // APP_NAME est lu ici, et non au chargement du fichier : les constantes
  // partagées entre fichiers .gs ne sont fiables qu'à l'exécution.
  var menu = SpreadsheetApp.getUi().createMenu(APP_NAME);
  MENU_ITEMS.forEach(function (item) {
    menu.addItem(item.caption, item.functionName);
  });
  menu.addToUi();
}
