import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import {
  IMPORT_TYPE,
  PACK_TYPE,
  packDocId,
  packDocuments,
} from "../src/pack.js";
import manifest from "../extension.json" with { type: "json" };

const packFile = new URL("../packs/demo-monsters.json", import.meta.url);

async function loadPack() {
  return JSON.parse(await readFile(packFile, "utf-8"));
}

describe("packDocuments", () => {
  it("maps every entry to a read-only pack document at ITS declared version", async () => {
    const pack = await loadPack();
    const { docs, errors } = packDocuments(pack);
    expect(errors).toEqual([]);
    expect(docs).toHaveLength(pack.entries.length);
    const goblin = docs.find((d) => d.id === packDocId("demo-monsters", "goblin"));
    expect(goblin).toMatchObject({
      id: "pack-demo-monsters-goblin",
      type: PACK_TYPE,
      name: "Goblin",
      ownership: {},
    });
    // v2 entry stays at v2; the v1 entries stay at v1 so the lazy migration
    // has something real to do.
    expect(goblin.schemaVersion).toBe(2);
    const old = docs.find((d) => d.id.endsWith("old-troll"));
    expect(old.schemaVersion).toBe(1);
  });

  it("never uses the type's declared version — an entry is born at what the pack says", async () => {
    const { docs } = packDocuments({
      id: "p",
      entries: [{ id: "e", name: "E", schemaVersion: 0, system: { a: 1 } }],
    });
    // The manifest declares 2 for both types; if the loader resolved that,
    // the lazy path would have nothing to migrate and the whole point of
    // scope:"compendium" would be untestable.
    expect(docs[0].schemaVersion).toBe(0);
  });

  it("rejects a bad entry without dropping the good ones", () => {
    const { docs, errors } = packDocuments({
      id: "p",
      entries: [
        { id: "ok", name: "Ok", schemaVersion: 2, system: {} },
        { id: "bad id", name: "Bad", schemaVersion: 2, system: {} },
        { id: "noversion", name: "NoVersion", system: {} },
        { id: "nosystem", name: "NoSystem", schemaVersion: 1 },
      ],
    });
    expect(docs.map((d) => d.id)).toEqual(["pack-p-ok"]);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/invalid entry id/);
  });

  it("rejects an unusable pack outright", () => {
    expect(packDocuments(null).errors[0]).toMatch(/not an object/);
    expect(packDocuments({ id: "p" }).errors[0]).toMatch(/no entries array/);
    expect(packDocuments({ id: "no spaces", entries: [] }).errors[0]).toMatch(/invalid pack id/);
  });
});

describe("manifest coherence", () => {
  it("declares the two types the code uses, with the scope that makes them behave differently", () => {
    const types = manifest.contributes.documentTypes;
    const pack = types.find((t) => t.id === PACK_TYPE);
    const imported = types.find((t) => t.id === IMPORT_TYPE);
    expect(pack).toMatchObject({ base: "Actor", schemaVersion: 2, scope: "compendium" });
    // The campaign type has NO scope: it is the default "campaign", which is
    // what makes an imported monster editable. If someone adds
    // scope:"compendium" here, imports silently become read-only forever.
    expect(imported).toMatchObject({ base: "Actor", schemaVersion: 2 });
    expect(imported.scope).toBeUndefined();
  });

  it("both types declare the same schemaVersion, so the chain target matches", () => {
    const versions = manifest.contributes.documentTypes.map((t) => t.schemaVersion);
    expect(new Set(versions).size).toBe(1);
  });

  it("contributes a sheet only for the campaign type", () => {
    const sheets = manifest.contributes.sheets.map((s) => s.documentType);
    expect(sheets).toEqual([IMPORT_TYPE]);
  });
});
