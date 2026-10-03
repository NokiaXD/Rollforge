//  Pure pack → document mapping. No `api`, no fs: everything here is a
//  function of the pack file, so it is directly testable and the server
//  entry stays a thin loop over it.
//
//  The extension ships one pack type (PACK_TYPE, a read-only wrapper) and one
//  campaign type (IMPORT_TYPE, what an import produces). Two ids, not one,
//  because scope:"compendium" is a property of the TYPE: a copy created with
//  the pack's type would inherit the read-only gate and be permanently
//  uneditable. The import is where the type changes — and the type change is
//  done by the host, from { id, type, sourceId }, never by the client.

export const PACK_TYPE = "compendium-actor";
export const IMPORT_TYPE = "compendium-monster";

// Document ids must match /^[a-zA-Z0-9_-]{1,128}$/ (DocumentStore.save),
// so pack and entry ids are kebab and dots are rejected rather than
// silently mangled.
const ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

export function packDocId(packId, entryId) {
  return `pack-${packId}-${entryId}`;
}

export function campaignDocId() {
  return `monster-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Turn a pack file into the DocumentInput list the loader creates.
 *
 * @param {{id: string, name?: string, entries: Array<{id: string, name: string, schemaVersion: number, system: object}>}} pack
 * @returns {{docs: object[], errors: string[]}}
 */
export function packDocuments(pack) {
  const errors = [];
  const docs = [];
  if (!pack || typeof pack !== "object") {
    return { docs, errors: ["pack file is not an object"] };
  }
  if (typeof pack.id !== "string" || !ID_RE.test(pack.id)) {
    return { docs, errors: [`invalid pack id "${String(pack.id)}"`] };
  }
  if (!Array.isArray(pack.entries)) {
    return { docs, errors: [`pack "${pack.id}" has no entries array`] };
  }

  for (const entry of pack.entries) {
    const label = `pack "${pack.id}" entry`;
    if (!entry || typeof entry !== "object") {
      errors.push(`${label}: not an object`);
      continue;
    }
    if (typeof entry.id !== "string" || !ID_RE.test(entry.id)) {
      errors.push(`${label}: invalid entry id "${String(entry.id)}"`);
      continue;
    }
    if (!Number.isInteger(entry.schemaVersion) || entry.schemaVersion < 0) {
      errors.push(`${label} "${entry.id}": schemaVersion must be a non-negative integer`);
      continue;
    }
    if (!entry.system || typeof entry.system !== "object") {
      errors.push(`${label} "${entry.id}": system must be an object`);
      continue;
    }
    docs.push({
      id: packDocId(pack.id, entry.id),
      type: PACK_TYPE,
      name: typeof entry.name === "string" && entry.name ? entry.name : entry.id,
      system: entry.system,
      flags: {},
      // Read-only over HTTP; ownership is irrelevant for a pack entry, and
      // the campaign copy gets its own when it is imported.
      ownership: {},
      // Explicit, and NOT the type's declared version: an entry is authored
      // at whatever version the pack was written against, and the lazy
      // migration is what brings it up to date. This is the whole point of
      // scope:"compendium" — a v1 entry must be allowed to exist unmigrated.
      schemaVersion: entry.schemaVersion,
    });
  }
  return { docs, errors };
}

/** Read a pack file from disk. Node-only: used by main.server.js. */
export async function readPack(url) {
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(url, "utf-8");
  return JSON.parse(raw);
}
