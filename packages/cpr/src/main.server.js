import { migrations } from "./migrations.js";

//  The Cyberpunk RED system (Paso 25). base Actor, so a cpr-character shows up
//  in the core Actores view for free and its sheet opens from the same modal —
//  the extension owns the rules, not a second actor browser.
//
//  The server half is deliberately almost empty: the stat block is nine
//  numbers, and Reflejos / MOVE / puntos restantes are derived on read by the
//  client. Nothing here has to keep them consistent, because nothing stores
//  them.

export function activate(api) {
  // Declared in the manifest at schemaVersion 2, so this chain is what makes
  // the type honest: registerMigrations refuses a chain that does not end at
  // the manifest's version, and the host refuses writes to a contributed type
  // with no chain until the extension is Active.
  api.documents.registerMigrations("cpr-character", migrations);
}

export function deactivate() {
  // Nothing to undo: the host clears contributions, migrations and hooks on
  // deactivate. Characters stay in the world DB — deleting them is a GM
  // decision.
}