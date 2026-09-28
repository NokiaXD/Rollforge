import semver from "semver";
import type { ExtensionManifest, ChatCommandContribution } from "@rollforge/protocol";

export const CORE_VERSION = "0.1.0";

const KEBAB_CASE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COMMAND_NAME_RE = /^[a-z0-9_-]+$/;

export interface ManifestValidationResult {
  ok: boolean;
  error?: string;
  manifest?: ExtensionManifest;
  effectiveEvents?: string[];
}

export function validateManifest(
  raw: unknown,
  coreVersion: string = CORE_VERSION
): ManifestValidationResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Manifest must be a non-null object" };
  }

  const m = raw as Partial<ExtensionManifest>;

  if (!m.id || typeof m.id !== "string" || !KEBAB_CASE_RE.test(m.id)) {
    return {
      ok: false,
      error: `Manifest "id" must be a non-empty kebab-case string (received "${m.id}")`,
    };
  }

  if (!m.name || typeof m.name !== "string" || !m.name.trim()) {
    return { ok: false, error: `Manifest "name" must be a non-empty string` };
  }

  if (!m.version || typeof m.version !== "string" || !semver.valid(m.version)) {
    return {
      ok: false,
      error: `Manifest "version" must be a valid semver string (received "${m.version}")`,
    };
  }

  if (!m.engines || typeof m.engines !== "object" || typeof m.engines.core !== "string") {
    return { ok: false, error: `Manifest "engines.core" must be a semver range string` };
  }

  // Builtin extensions are exempt from core version check
  if (!m.builtin) {
    if (!semver.satisfies(coreVersion, m.engines.core)) {
      return {
        ok: false,
        error: `Extension "${m.id}" requires core version "${m.engines.core}", incompatible with "${coreVersion}"`,
      };
    }
  }

  if (!Array.isArray(m.activationEvents)) {
    return { ok: false, error: `Manifest "activationEvents" must be an array of strings` };
  }

  if (m.activationEvents.includes("*")) {
    return { ok: false, error: `Wildcard '*' in activationEvents is forbidden` };
  }

  const contributedCommands = new Set<string>();
  if (m.contributes?.chatCommands) {
    if (!Array.isArray(m.contributes.chatCommands)) {
      return { ok: false, error: `Manifest "contributes.chatCommands" must be an array` };
    }
    for (const cmd of m.contributes.chatCommands as ChatCommandContribution[]) {
      if (!cmd.name || typeof cmd.name !== "string" || !COMMAND_NAME_RE.test(cmd.name.toLowerCase())) {
        return {
          ok: false,
          error: `Invalid chat command name "${cmd.name}". Must be canonical alphanumeric/dash/underscore.`,
        };
      }
      contributedCommands.add(cmd.name.toLowerCase());
    }
  }

  // Coherence: any explicit onCommand:<x> must exist in contributes.chatCommands
  for (const event of m.activationEvents) {
    if (typeof event !== "string") {
      return { ok: false, error: `Activation event must be a string` };
    }
    if (event.startsWith("onCommand:")) {
      const cmdName = event.slice("onCommand:".length).toLowerCase();
      if (!contributedCommands.has(cmdName)) {
        return {
          ok: false,
          error: `Activation event "${event}" references command "${cmdName}" not found in contributes.chatCommands`,
        };
      }
    }
  }

  // Derived activation events from contributes.chatCommands
  const derivedEvents = Array.from(contributedCommands).map((c) => `onCommand:${c}`);
  const effectiveEvents = Array.from(new Set([...m.activationEvents, ...derivedEvents]));

  if (effectiveEvents.length === 0) {
    return {
      ok: false,
      error: `Extension "${m.id}" has an empty effective activationEvents set and will never activate`,
    };
  }

  return {
    ok: true,
    manifest: m as ExtensionManifest,
    effectiveEvents,
  };
}
