import { migrations } from "./migrations.js";
import { IMPORT_TYPE, PACK_TYPE, packDocuments, readPack } from "./pack.js";

//  Official compendium extension (Paso 18). Everything it needs comes from
//  the frozen API: no direct DB, no direct registry, no host imports.
//
//  Two document types, one chain:
//    PACK_TYPE    scope:"compendium" — one read-only document per pack
//                 entry. Never migrated at activation (§12: thousands of
//                 entries must not block boot); migrated on first open/import.
//    IMPORT_TYPE  scope:"campaign" (the default) — what an import produces,
//                 editable, with its own sheet.
//
//  Packs are read from ./packs/*.json. `load` is an explicit GM command
//  rather than activation-time work, so installing this extension costs the
//  boot nothing at all.

const PACKS = [
  { id: "demo-monsters", file: new URL("../packs/demo-monsters.json", import.meta.url) },
];

export function activate(api) {
  // Same chain for both types. The wrapper needs it for the lazy path; the
  // campaign type needs it for the eager path, so a document that was
  // imported before the pack was upgraded is picked up on re-activation.
  api.documents.registerMigrations(PACK_TYPE, migrations);
  api.documents.registerMigrations(IMPORT_TYPE, migrations);

  api.chat.registerCommand({
    name: "compendio",
    description: "Compendios: packs | load <packId>",
    requiredPermission: "GM",
    handler: async ({ rest }) => {
      const [sub, arg] = rest.trim().split(/\s+/);

      if (sub === "packs" || sub === undefined) {
        const lines = PACKS.map((p) => `· ${p.id} (${p.file.pathname.split("/").pop()})`);
        await api.chat.send(
          lines.length ? `Compendios disponibles:\n${lines.join("\n")}` : "No hay packs instalados.",
          { kind: "system" },
        );
        return;
      }

      if (sub === "load") {
        const pack = PACKS.find((p) => p.id === arg);
        if (!pack) {
          throw new api.errors.CommandRejection(`Pack desconocido "${String(arg)}".`);
        }
        const { docs, errors } = packDocuments(await readPack(pack.file));
        let created = 0;
        let skipped = 0;
        for (const doc of docs) {
          // Idempotent: a second `load` must not fork the pack, and pack
          // documents are read-only over HTTP so re-creating is the only way
          // to refresh one — which is deliberately not offered.
          const existing = await api.documents.get(doc.id);
          if (existing) {
            skipped += 1;
            continue;
          }
          await api.documents.create(doc);
          created += 1;
        }
        const detail = errors.length ? `\nEntradas rechazadas: ${errors.length}\n${errors.join("\n")}` : "";
        await api.chat.send(
          `Pack "${pack.id}": ${created} entrada(s) cargadas, ${skipped} ya existían.${detail}`,
          { kind: "system" },
        );
        return;
      }

      throw new api.errors.CommandRejection(
        'Uso: /compendio packs | /compendio load <packId>',
      );
    },
  });
}

export function deactivate() {
  // Nothing to undo: the host clears hooks, commands and contributions on
  // deactivate. Pack documents stay in the world DB (deleting them is a GM
  // decision, and re-running `load` reuses them).
}
