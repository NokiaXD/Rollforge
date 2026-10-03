import { describe, it, expect } from "vitest";
import { runMigration, runChain } from "@rollforge/extension-api/testing";
import { migrateV0ToV1, migrateV1ToV2, migrations } from "../src/migrations.js";

describe("compendium migrations", () => {
  it("migrateV0ToV1 backfills ac and a hp block", async () => {
    const result = await runMigration(migrateV0ToV1, { name: "Goblin", hp: { value: 7, max: 7 } });
    expect(result).toEqual({
      name: "Goblin",
      ac: 10,
      hp: { value: 7, max: 7 },
    });
  });

  it("migrateV1ToV2 derives cr from ac", async () => {
    const result = await runMigration(migrateV1ToV2, { name: "Hobgoblin", ac: 18, hp: {} });
    // floor((18 - 10) / 4) = 2
    expect(result.cr).toBe(2);
  });

  it("migrateV1ToV2 throws on an entry with no numeric ac", async () => {
    // The data-dependent failure that gives the lazy path its per-document
    // blast radius: a pack authored before the stat existed blocks ITSELF
    // and nothing else.
    await expect(runMigration(migrateV1ToV2, { name: "Ancient", hp: { value: 9, max: 9 } })).rejects.toThrow(
      /requires a numeric 'ac'/,
    );
  });

  it("runChain walks a v0 entry up to v2", async () => {
    const result = await runChain(migrations, { name: "Ogro", hp: { value: 59, max: 59 } }, 0, 2);
    expect(result.ac).toBe(10);
    expect(result.cr).toBe(0);
  });

  it("runChain over a v1 entry reaches v2", async () => {
    // runChain expects a chain that STARTS at fromVersion (it walks every
    // step in order), so a mid-chain entry needs the tail of the chain.
    const result = await runChain(migrations.slice(1), { name: "Troll", ac: 15, hp: { value: 44, max: 44 } }, 1, 2);
    expect(result.cr).toBe(1);
  });
});
