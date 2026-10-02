import { describe, it, expect } from "vitest";
import { isExtensionReady, isMigrationUnblocked, ownerOfType } from "./documentsGate";
import { ExtensionManager } from "../extensions/manager";
import { ChatCommandRegistry } from "../extensions/registry";
import { HooksEngine } from "@rollforge/extension-api";
import type { ExtensionManifest } from "@rollforge/protocol";
import Database, { type Database as DB } from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentStore } from "./documentStore";
import { migrate } from "./migrations";

function makeManager(): { manager: ExtensionManager; store: DocumentStore; db: DB; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "rollforge-gate-"));
  const dbPath = join(dir, "w.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  const store = new DocumentStore(db);
  const manager = new ExtensionManager({
    hooks: new HooksEngine(),
    commandRegistry: new ChatCommandRegistry(),
    getDocumentStore: () => store,
    getDocumentDb: () => db,
  });
  return { manager, store, db, dir };
}

const contributedManifest: ExtensionManifest = {
  id: "sheets-ext",
  name: "Sheets",
  version: "1.0.0",
  engines: { core: ">=0.1.0" },
  activationEvents: ["onReady"],
  contributes: {
    documentTypes: [{ id: "cpr-character", base: "Actor", schemaVersion: 1 }],
  },
};

describe("documentsGate", () => {
  it("isExtensionReady returns true for base types with no owner", () => {
    const { manager } = makeManager();
    expect(isExtensionReady(manager, "Actor")).toBe(true);
    expect(isExtensionReady(manager, "Item")).toBe(true);
    expect(isExtensionReady(manager, "Scene")).toBe(true);
  });

  it("isExtensionReady returns false for contributed type while extension is Registered", () => {
    const { manager } = makeManager();
    manager.registerExtension({ manifest: contributedManifest });
    expect(isExtensionReady(manager, "cpr-character")).toBe(false);
  });

  it("isExtensionReady returns true once the extension activates", async () => {
    const { manager } = makeManager();
    manager.registerExtension({
      manifest: contributedManifest,
      activate: () => {},
    });
    await manager.ensureActivated("sheets-ext");
    expect(isExtensionReady(manager, "cpr-character")).toBe(true);
  });

  it("ownerOfType returns undefined for base types and the extension id for contributed types", () => {
    const { manager } = makeManager();
    expect(ownerOfType(manager, "Actor")).toBeUndefined();
    manager.registerExtension({ manifest: contributedManifest });
    expect(ownerOfType(manager, "cpr-character")).toBe("sheets-ext");
  });

  it("isMigrationUnblocked returns true for a non-existent doc", () => {
    const { store } = makeManager();
    expect(isMigrationUnblocked(store, "missing")).toBe(true);
  });

  it("isMigrationUnblocked returns true for an ok doc", () => {
    const { store, manager } = makeManager();
    manager.registerExtension({ manifest: contributedManifest });
    store.save({
      id: "d1",
      type: "cpr-character",
      name: "d",
      system: {},
      flags: {},
      ownership: { default: "LIMITED" },
    });
    expect(isMigrationUnblocked(store, "d1")).toBe(true);
  });

  it("isMigrationUnblocked returns false for a doc with migration_status='blocked'", () => {
    const { store, manager } = makeManager();
    manager.registerExtension({ manifest: contributedManifest });
    const saved = store.save({
      id: "d2",
      type: "cpr-character",
      name: "d",
      system: {},
      flags: {},
      ownership: { default: "LIMITED" },
    });
    store.update({ ...saved, migrationStatus: "blocked" }, saved._rev);
    expect(isMigrationUnblocked(store, "d2")).toBe(false);
  });
});