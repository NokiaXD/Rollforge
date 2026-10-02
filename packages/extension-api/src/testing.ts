import { validateMigrationChain, type MigrationChain, type MigrationStep } from "@rollforge/protocol";

//  testing helpers live here, NOT in ServerExtensionAPI. They are
// imported directly from "@rollforge/extension-api/testing" by extension
// authors in their .test.ts files. Putting them in the frozen runtime API
// would mean every extension pays the bundle cost of test-only helpers and
// every test helper would be locked under §13 semver.

// Run a single migration step. Useful for unit-testing an `up` function in
// isolation. Returns the transformed system; does not touch any database.
export async function runMigration<TSystem>(
  migration: MigrationStep<TSystem>["up"],
  input: TSystem,
): Promise<TSystem> {
  return migration(input);
}

// Run a complete chain in-memory (no DB). Asserts contiguity before
// executing so a misconfigured test surfaces immediately rather than silently
// passing only the matching ones.
export async function runChain<TSystem>(
  chain: MigrationChain<TSystem>,
  input: TSystem,
  fromVersion: number,
  targetVersion: number,
): Promise<TSystem> {
  const issue = validateMigrationChain(chain as MigrationChain, targetVersion);
  if (issue) throw new Error(`runChain: ${issue}`);
  let current = input;
  let version = fromVersion;
  for (const step of chain) {
    if (step.from !== version) {
      throw new Error(
        `runChain: step ${step.from}->${step.to} does not start at current ${version}`,
      );
    }
    current = await step.up(current);
    version = step.to;
  }
  if (version !== targetVersion) {
    throw new Error(
      `runChain: chain ends at ${version} but targetVersion is ${targetVersion}`,
    );
  }
  return current;
}