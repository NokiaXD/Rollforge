//  The pack's schema chain, registered for BOTH the wrapper type and the
//  campaign type (see main.server.js). Keeping one chain for both is what
//  makes an import lossless: the source is migrated to the chain's target and
//  the copy is born at that same version.
//
//  v0 → v1: pre-`ac` stat blocks.
//  v1 → v2: derived combat numbers, keyed off `ac`.
//
//  The v1→v2 step is data-dependent on purpose: it throws when the document
//  has no numeric `ac`. That is the shape of a real chain bug (a pack authored
//  before a stat existed), and it exercises the per-document blast radius of
//  Paso 15 on the lazy path — one bad entry blocks itself and nothing else.

export function migrateV0ToV1(system) {
  const current = system && typeof system === "object" ? { ...system } : {};
  return {
    ...current,
    ac: typeof current.ac === "number" ? current.ac : 10,
    hp: current.hp && typeof current.hp === "object" ? { ...current.hp } : { current: 1, max: 1 },
  };
}

export function migrateV1ToV2(system) {
  const current = system && typeof system === "object" ? { ...system } : {};
  if (typeof current.ac !== "number") {
    throw new Error("v1→v2 requires a numeric 'ac'; the pack entry predates the stat");
  }
  const hp = current.hp && typeof current.hp === "object" ? { ...current.hp } : {};
  return {
    ...current,
    hp,
    cr: Math.max(0, Math.floor((current.ac - 10) / 4)),
  };
}

export const migrations = [
  { from: 0, to: 1, up: migrateV0ToV1 },
  { from: 1, to: 2, up: migrateV1ToV2 },
];
