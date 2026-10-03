export function migrateV0ToV1(system) {
  const current = system && typeof system === "object" ? { ...system } : {};
  return {
    ...current,
    ac: current.ac ?? 10,
  };
}

export function migrateV1ToV2(system) {
  const current = system && typeof system === "object" ? { ...system } : {};
  const hp = current.hp && typeof current.hp === "object" ? { ...current.hp } : {};
  if ("value" in hp) {
    hp.current = hp.value;
    delete hp.value;
  }
  return {
    ...current,
    hp,
  };
}

export const migrations = [
  { from: 0, to: 1, up: migrateV0ToV1 },
  { from: 1, to: 2, up: migrateV1ToV2 },
];
