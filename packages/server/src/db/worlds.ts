import { mkdirSync } from "node:fs";
import { join } from "node:path";

export function worldDbPath(dataDir: string, worldId: string): string {
  return join(dataDir, "worlds", worldId, "world.db");
}

export function ensureWorldDir(dataDir: string, worldId: string): string {
  mkdirSync(join(dataDir, "worlds", worldId), { recursive: true });
  return worldDbPath(dataDir, worldId);
}