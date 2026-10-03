import semver from "semver";
import type {
  ExtensionManifest,
  ChatCommandContribution,
  DocumentTypeContribution,
  SheetContribution,
} from "@rollforge/protocol";

export const CORE_VERSION = "0.1.0";

const KEBAB_CASE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COMMAND_NAME_RE = /^[a-z0-9_-]+$/;
const DOC_TYPE_BASES = new Set(["Actor", "Item", "Scene"]);

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

  const contributedDocTypeIds = new Set<string>();
  if (m.contributes?.documentTypes) {
    if (!Array.isArray(m.contributes.documentTypes)) {
      return { ok: false, error: `Manifest "contributes.documentTypes" must be an array` };
    }
    for (const dt of m.contributes.documentTypes as DocumentTypeContribution[]) {
      if (!dt.id || typeof dt.id !== "string" || !KEBAB_CASE_RE.test(dt.id)) {
        return {
          ok: false,
          error: `Invalid documentType id "${dt.id}". Must be kebab-case.`,
        };
      }
      if (!DOC_TYPE_BASES.has(dt.base)) {
        return {
          ok: false,
          error: `documentType "${dt.id}" has invalid base "${dt.base}". Must be one of Actor/Item/Scene.`,
        };
      }
      if (!Number.isInteger(dt.schemaVersion) || dt.schemaVersion < 0) {
        return {
          ok: false,
          error: `documentType "${dt.id}" schemaVersion must be a non-negative integer (received ${String(dt.schemaVersion)}).`,
        };
      }
      if (dt.scope !== undefined && dt.scope !== "campaign" && dt.scope !== "compendium") {
        return {
          ok: false,
          error: `documentType "${dt.id}" has invalid scope "${String(dt.scope)}". Must be "campaign" or "compendium".`,
        };
      }
      if (contributedDocTypeIds.has(dt.id)) {
        return {
          ok: false,
          error: `documentType id "${dt.id}" appears more than once in contributes.documentTypes.`,
        };
      }
      contributedDocTypeIds.add(dt.id);
    }
  }

  const defaultPerDocType = new Set<string>();
  if (m.contributes?.sheets) {
    if (!Array.isArray(m.contributes.sheets)) {
      return { ok: false, error: `Manifest "contributes.sheets" must be an array` };
    }
    for (const sh of m.contributes.sheets as SheetContribution[]) {
      if (!sh.documentType || typeof sh.documentType !== "string") {
        return {
          ok: false,
          error: `Invalid sheet entry: documentType must be a non-empty string.`,
        };
      }
      if (!contributedDocTypeIds.has(sh.documentType) && !DOC_TYPE_BASES.has(sh.documentType)) {
        return {
          ok: false,
          error: `sheet for documentType "${sh.documentType}" must reference either a contributed id in contributes.documentTypes or a base type (Actor/Item/Scene).`,
        };
      }
      if (sh.default === true) {
        if (defaultPerDocType.has(sh.documentType)) {
          return {
            ok: false,
            error: `Multiple sheets in manifest marked default: true for documentType "${sh.documentType}".`,
          };
        }
        defaultPerDocType.add(sh.documentType);
      }
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
