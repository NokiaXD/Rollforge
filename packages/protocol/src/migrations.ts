// Document migration contracts (§12). Steps run inside one SQLite transaction
// per step; the runner applies them in order from current `schemaVersion`
// up to the target declared by the extension's documentType contribution.
// Down-migrations are intentionally absent — see Paso 15 design doc.
export interface MigrationStep<TSystem = Record<string, unknown>> {
  from: number;
  to: number;
  up: (input: TSystem) => TSystem | Promise<TSystem>;
}

export type MigrationChain<TSystem = Record<string, unknown>> = Array<
  MigrationStep<TSystem>
>;

//  validation is a pure function so it lives next to the type.
// Returns the first issue it finds, or null when the chain is sound.
export function validateMigrationChain(
  chain: MigrationChain,
  targetVersion: number,
): string | null {
  if (chain.length === 0) {
    if (targetVersion === 0) return null;
    return `chain is empty but targetVersion is ${targetVersion}`;
  }
  let expected = chain[0]!.from;
  for (let i = 0; i < chain.length; i++) {
    const step = chain[i]!;
    if (step.from !== expected) {
      return `step ${i} starts at ${step.from}, expected ${expected}`;
    }
    if (step.to !== step.from + 1) {
      return `step ${i} (${step.from}→${step.to}) is not a single-version bump`;
    }
    if (step.from < 0 || step.to < 0) {
      return `step ${i} has negative version`;
    }
    expected = step.to;
  }
  const last = chain[chain.length - 1]!;
  if (last.to !== targetVersion) {
    return `chain ends at ${last.to} but targetVersion is ${targetVersion}`;
  }
  return null;
}