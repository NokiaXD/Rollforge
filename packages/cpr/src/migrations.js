//  The character chain: v0 → v1 → v2.
//
//  v1 was six stats named in English (body, cool, dex, int, per, tech) plus
//  three more (emp, luck, will), all of them wrong: it invented a Percepción
//  that CP RED does not have — perception is part of INT — and it left Reflejos
//  and Movimiento out, treating them as derived when the core lists both as
//  characteristics of their own. v2 is the ten, keyed by the book's own
//  Spanish abbreviations.
//
//  New documents are born at the CURRENT version (the host's
//  schemaVersionResolver), so these steps only ever run against a
//  cpr-character created by an older build. They fill missing stats at their
//  floor rather than throwing: a stat block is the whole document, so a failure
//  here would block the character instead of pointing at the field.

// ponytail: mirrored by STAT_KEYS in main.client.js. Two copies because the
// client file is served raw to the browser and cannot be imported by the server
// (it would pull in a second preact). The test asserts the two agree.
export const STAT_KEYS = ["int", "vol", "fri", "emp", "tec", "ref", "sue", "tco", "des", "mov"];
export const STAT_MIN = 1;

//  Only the six v0/v1 names that still mean something. `per` is dropped on the
//  floor: it was never a CP RED stat, and `derived()` ignores keys it does not
//  know, so there is nothing to clean up on the client.
const V1_RENAMES = { int: "int", will: "vol", cool: "fri", emp: "emp", tech: "tec", body: "tco", dex: "des", luck: "sue" };

export function migrateV0ToV1(system) {
  const current = system && typeof system === "object" ? { ...system } : {};
  const stats = current.stats && typeof current.stats === "object" ? { ...current.stats } : {};
  for (const key of ["body", "cool", "dex", "int", "per", "tech"]) {
    const value = Number(stats[key]);
    if (!Number.isFinite(value)) stats[key] = STAT_MIN;
  }
  return { ...current, stats };
}

export function migrateV1ToV2(system) {
  const current = system && typeof system === "object" ? { ...system } : {};
  const old = current.stats && typeof current.stats === "object" ? current.stats : {};
  const stats = {};
  for (const [from, to] of Object.entries(V1_RENAMES)) {
    const value = Number(old[from]);
    stats[to] = Number.isFinite(value) ? value : STAT_MIN;
  }
  // REF, SUE and MOV did not exist in v1.
  for (const key of STAT_KEYS) if (!(key in stats)) stats[key] = STAT_MIN;
  return { ...current, stats };
}

export const migrations = [
  { from: 0, to: 1, up: migrateV0ToV1 },
  { from: 1, to: 2, up: migrateV1ToV2 },
];