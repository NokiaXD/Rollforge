import { describe, it, expect } from "vitest";
import { runMigration, runChain } from "@rollforge/extension-api/testing";
import { migrateV0ToV1, migrateV1ToV2, migrations } from "../src/migrations.js";

describe("Example RPG migrations", () => {
  it("migrateV0ToV1 adds ac: 10 while keeping the rest intact", async () => {
    const v0Doc = { name: "Warrior", hp: { value: 20, max: 20 } };
    const result = await runMigration(migrateV0ToV1, v0Doc);

    expect(result).toEqual({
      name: "Warrior",
      hp: { value: 20, max: 20 },
      ac: 10,
    });
  });

  it("migrateV1ToV2 renames hp.value to hp.current", async () => {
    const v1Doc = { name: "Warrior", hp: { value: 15, max: 20 }, ac: 10 };
    const result = await runMigration(migrateV1ToV2, v1Doc);

    expect(result).toEqual({
      name: "Warrior",
      hp: { current: 15, max: 20 },
      ac: 10,
    });
    expect(result.hp.value).toBeUndefined();
  });

  it("runChain migrates v0 through v2 completely", async () => {
    const v0Doc = { name: "Mage", hp: { value: 12, max: 12 }, mana: 30 };
    const result = await runChain(migrations, v0Doc, 0, 2);

    expect(result).toEqual({
      name: "Mage",
      hp: { current: 12, max: 20 < 12 ? 20 : 12 },
      mana: 30,
      ac: 10,
    });
    expect(result.hp.current).toBe(12);
    expect(result.hp.value).toBeUndefined();
  });

  it("runChain throws if fromVersion > targetVersion or invalid chain", async () => {
    const v0Doc = { name: "Rogue" };
    await expect(runChain(migrations, v0Doc, 2, 1)).rejects.toThrow();
  });

  it("runChain throws on broken or non-contiguous step", async () => {
    const brokenChain = [
      { from: 0, to: 1, up: migrateV0ToV1 },
      { from: 3, to: 4, up: migrateV1ToV2 },
    ];
    const v0Doc = { name: "Rogue" };
    await expect(runChain(brokenChain, v0Doc, 0, 4)).rejects.toThrow();
  });
});
