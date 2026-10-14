import { describe, it, expect } from "vitest";
import { derived, POINT_POOL, STAT_START, STAT_KEYS as CLIENT_STAT_KEYS } from "../src/client/rules";
import { ARCHETYPES } from "../src/client/archetypes";
import { migrateV0ToV1, migrateV1ToV2, STAT_KEYS } from "../src/migrations.js";

const all = (n) => Object.fromEntries(STAT_KEYS.map((key) => [key, n]));

describe("derived", () => {
  it("calculates spent and remaining points from the 62 point pool", () => {
    // 10 stats at 1 = 10 spent, 52 left of 62
    const d1 = derived(all(1));
    expect(d1.spent).toBe(10);
    expect(d1.left).toBe(POINT_POOL - 10);

    // Initial character builder stats start at STAT_START (2 for each stat)
    const d2 = derived(all(STAT_START));
    expect(d2.spent).toBe(20);
    expect(d2.left).toBe(42);
  });

  it("calculates fully allocated character correctly", () => {
    // 8 stats of 6 (48) + 2 stats of 7 (14) = 62 total
    const stats = Object.fromEntries(STAT_KEYS.map((k, i) => [k, i < 8 ? 6 : 7]));
    const d = derived(stats);
    expect(d.spent).toBe(62);
    expect(d.left).toBe(0);
  });

  it("clamps every stat into 1..15 and never returns NaN", () => {
    const d = derived({ tco: 99, fri: -4, des: "siete", int: null, emp: 6.6, mov: 0 });
    expect(d.stats).toEqual({
      int: 1,
      vol: 1,
      fri: 1,
      emp: 7,
      tec: 1,
      ref: 1,
      sue: 1,
      tco: 15,
      des: 1,
      mov: 1,
    });
  });

  it("keeps REF and MOV as the character's own numbers", () => {
    // The core lists both as Characteristics of their own; nothing derives them.
    const d = derived({ ref: 14, mov: 7, des: 1, tco: 1 });
    expect(d.stats.ref).toBe(14);
    expect(d.stats.mov).toBe(7);
  });

  it("survives a document with no stats at all", () => {
    expect(derived(undefined)).toEqual(derived(all(1)));
  });
});

describe("stat key sets", () => {
  it("the sheet's ten keys and the migration chain's ten keys are the same set", () => {
    // Two copies of the list by necessity (the client file is served raw), so
    // this is the one thing keeping them from drifting.
    expect([...CLIENT_STAT_KEYS].sort()).toEqual([...STAT_KEYS].sort());
  });
});

describe("migrateV0ToV1", () => {
  it("fills the six v1 stats on a stat-less v0 document", () => {
    expect(migrateV0ToV1({ notes: "vieja" })).toEqual({
      notes: "vieja",
      stats: { body: 1, cool: 1, dex: 1, int: 1, per: 1, tech: 1 },
    });
  });

  it("keeps whatever stats were already there and does not touch the rest", () => {
    expect(migrateV0ToV1({ stats: { body: 12, dex: 9 } }).stats).toEqual({
      body: 12,
      cool: 1,
      dex: 9,
      int: 1,
      per: 1,
      tech: 1,
    });
  });
});

describe("migrateV1ToV2", () => {
  it("renames the v1 keys to the book's abbreviations and drops Percepción", () => {
    const v1 = {
      stats: { body: 12, cool: 9, dex: 7, emp: 6, int: 10, luck: 5, per: 11, tech: 8, will: 4 },
    };
    expect(migrateV1ToV2(v1).stats).toEqual({
      int: 10,
      vol: 4,
      fri: 9,
      emp: 6,
      tec: 8,
      ref: 1,
      sue: 5,
      tco: 12,
      des: 7,
      mov: 1,
    });
  });

  it("does not reset a stat the character already had", () => {
    expect(migrateV1ToV2({ stats: { body: 13, dex: 10 } }).stats).toMatchObject({
      tco: 13,
      des: 10,
    });
  });

  it("leaves the rest of the system alone", () => {
    expect(migrateV1ToV2({ notes: "hola", stats: { body: 3 } })).toMatchObject({ notes: "hola" });
  });

  it("running the whole chain lands on the same state as a brand new v2 document", () => {
    //  What the host does on read: v0 → v1 → v2, then render.
    const migrated = migrateV1ToV2(migrateV0ToV1(undefined));
    expect(derived(migrated.stats)).toEqual(derived({}));
  });
});

describe("compendium archetypes", () => {
  it("every archetype defines all ten STAT_KEYS within range 1..15", () => {
    expect(ARCHETYPES.length).toBeGreaterThan(0);
    for (const arch of ARCHETYPES) {
      expect(Object.keys(arch.stats).sort()).toEqual([...STAT_KEYS].sort());
      for (const val of Object.values(arch.stats)) {
        expect(val).toBeGreaterThanOrEqual(1);
        expect(val).toBeLessThanOrEqual(15);
      }
    }
  });

  it("every archetype has non-empty metadata", () => {
    for (const arch of ARCHETYPES) {
      expect(arch.id).toBeTruthy();
      expect(arch.name).toBeTruthy();
      expect(arch.role).toBeTruthy();
      expect(arch.description).toBeTruthy();
    }
  });
});