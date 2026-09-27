import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { worldDbPath, ensureWorldDir } from "./worlds";

describe("worlds", () => {
  it("worldDbPath joins dataDir/worlds/<id>/world.db", () => {
    expect(worldDbPath("/var/data", "campaign1")).toBe(
      join("/var/data", "worlds", "campaign1", "world.db"),
    );
  });

  it("ensureWorldDir creates the directory and returns the db path", () => {
    const dataDir = join(process.env.TMPDIR ?? "/tmp", `rollforge-worlds-${Date.now()}`);
    const dbPath = ensureWorldDir(dataDir, "test-world");
    expect(dbPath).toBe(worldDbPath(dataDir, "test-world"));
    // subsequent mkdir is idempotent
    expect(() => ensureWorldDir(dataDir, "test-world")).not.toThrow();
  });
});