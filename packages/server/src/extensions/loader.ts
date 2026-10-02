import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionManifest } from "@rollforge/protocol";
import type { ExtensionEntry, ExtensionManager } from "./manager";

export interface DiscoveredExtension {
  /** Directory name, used only for diagnostics before the manifest is parsed. */
  dir: string;
  root: string;
  manifest?: ExtensionManifest | undefined;
  error?: string | undefined;
}

interface LoadedModule {
  activate?: ExtensionEntry["activate"];
  deactivate?: ExtensionEntry["deactivate"];
}

// Reads <dir>/<subdir>/extension.json for every immediate subdirectory.
// One broken extension yields an entry with `error`; it never throws.
export function discoverExtensions(dir: string): DiscoveredExtension[] {
  if (!existsSync(dir)) return [];
  const out: DiscoveredExtension[] = [];
  for (const sub of readdirSync(dir, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    const root = join(dir, sub.name);
    const manifestPath = join(root, "extension.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as ExtensionManifest;
      out.push({ dir: sub.name, root, manifest: raw });
    } catch (err) {
      out.push({
        dir: sub.name,
        root,
        error: `extension.json unreadable: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return out;
}

// Contributions-only extensions have no main.server entry, so they stay declarative.
export async function loadExtensionEntry(disc: DiscoveredExtension): Promise<ExtensionEntry> {
  const manifest = disc.manifest;
  if (!manifest) throw new Error(disc.error ?? `extension "${disc.dir}" has no manifest`);
  if (!manifest.main?.server) return { manifest };

  const rel = manifest.main.server;
  if (rel.startsWith("/") || rel.includes("..")) {
    throw new Error(`main.server "${rel}" must be a relative path inside the extension folder`);
  }
  // pathToFileURL: a raw Windows path ("C:\...") is not a valid import() specifier.
  const entryPath = resolve(disc.root, rel);
  if (!entryPath.startsWith(resolve(disc.root))) {
    throw new Error(`main.server "${rel}" escapes the extension folder`);
  }
  const mod = (await import(pathToFileURL(entryPath).href)) as LoadedModule;
  return { manifest, activate: mod.activate, deactivate: mod.deactivate };
}

export interface LoadExtensionsResult {
  loaded: string[];
  failed: Array<{ id: string; error: string }>;
}

// Registers every extension found in `dir`. Failures are per-extension and
// idempotent (an already-registered id is skipped), so this is safe to re-run.
export async function loadExtensions(
  manager: ExtensionManager,
  dir: string
): Promise<LoadExtensionsResult> {
  const result: LoadExtensionsResult = { loaded: [], failed: [] };

  for (const disc of discoverExtensions(dir)) {
    const id = disc.manifest?.id ?? disc.dir;
    if (disc.error) {
      result.failed.push({ id, error: disc.error });
      console.error(`[extensions] ${id}: ${disc.error}`);
      continue;
    }
    if (manager.getExtension(id)) {
      console.warn(`[extensions] ${id}: already registered, skipping`);
      continue;
    }
    try {
      const entry = await loadExtensionEntry(disc);
      const regResult = manager.registerExtension(entry);
      if (regResult.ok) {
        result.loaded.push(id);
      } else {
        result.failed.push({ id, error: regResult.reason });
        console.error(`[extensions] ${id}: ${regResult.reason}`);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      result.failed.push({ id, error });
      console.error(`[extensions] ${id}: ${error}`);
    }
  }

  return result;
}
