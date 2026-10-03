import type { ComponentType } from "preact";
import { SheetOwnerConflict } from "@rollforge/protocol";

export interface ClientSheetEntry {
  documentType: string;
  component: ComponentType<{ documentId: string }>;
  default?: boolean;
  //  tracks ownership so an extension can safely replace its own default
  // sheet (e.g. HMR, re-registration on activation) without colliding with a
  // peer that contributes a different sheet for the same type.
  extensionId?: string;
}

interface InternalSheetEntry {
  entry: ClientSheetEntry;
  // Prior default entry, if this slot was overridden. Cleared on consume so the
  // chain doesn't grow unbounded — one level is enough to revert on deactivate.
  previousDefault?: ClientSheetEntry;
}

//  server is the source of truth for extension-owned document types. The
// client mirrors that ownership here for `registerSheet({ default: true })` to
// validate against. Base types are seeded inline because the server never
// registers them (it only carries contributed types in DocumentTypeRegistry)
// and the core sheet for Actor is already part of bootstrap — seeding here
// removes the silent dependency that the static sheet registered before
// setOwnerMap arrived.
const BASE_TYPE_OWNERS: Readonly<Record<string, string>> = Object.freeze({
  Actor: "core:custom-actor-sheet",
  Item: "core",
  Scene: "core",
});

const sheets: InternalSheetEntry[] = [];
const ownerByType = new Map<string, string>(Object.entries(BASE_TYPE_OWNERS));

export function registerSheet(entry: ClientSheetEntry): void {
  const newId = entry.extensionId ?? "";

  if (entry.default !== true) {
    sheets.push({ entry });
    return;
  }

  // Default sheets must match the owner declared by the server's
  // DocumentTypeRegistry (or the BASE_TYPE_OWNERS seed for Actor/Item/Scene).
  // No "first wins" inference — the source of truth comes from
  // /api/document-types via setOwnerMap.
  const ownerId = ownerByType.get(entry.documentType);
  if (ownerId === undefined) {
    throw new SheetOwnerConflict(entry.documentType, "", newId);
  }
  if (newId !== ownerId) {
    throw new SheetOwnerConflict(entry.documentType, ownerId, newId);
  }

  const existingIdx = sheets.findIndex(
    (s) => s.entry.documentType === entry.documentType && s.entry.default === true,
  );

  if (existingIdx === -1) {
    sheets.push({ entry });
    return;
  }

  const existing = sheets[existingIdx]!;

  // Same owner overrides silently and keeps a one-deep history for restoration.
  sheets[existingIdx] = { entry, previousDefault: existing.entry };
}

// Merge the server's `documentType → extensionId` map onto the owner table.
// Pre-seeded base types are preserved (a partial merge, never a total
// replacement) so a wrong payload cannot accidentally drop ownership of
// Actor/Item/Scene. Idempotent — safe to call once at bootstrap.
export function setOwnerMap(map: Record<string, string | undefined>): void {
  for (const [type, owner] of Object.entries(map)) {
    if (owner === undefined) continue;
    ownerByType.set(type, owner);
  }
}

export function clearSheetsFor(extensionId: string): void {
  for (let i = sheets.length - 1; i >= 0; i--) {
    const s = sheets[i]!;
    if (s.entry.extensionId !== extensionId) continue;
    if (s.previousDefault) {
      // Restore the prior default. Ownership is owned by the server-side
      // registry and not transferred by deactivate; we keep the ownerByType
      // entry intact.
      const restored = s.previousDefault;
      sheets[i] = { entry: restored, previousDefault: undefined };
    } else {
      sheets.splice(i, 1);
    }
  }
}

export function sheetsFor(documentType: string): ClientSheetEntry[] {
  return sheets.filter((s) => s.entry.documentType === documentType).map((s) => s.entry);
}

export function defaultSheetFor(documentType: string): ClientSheetEntry | null {
  return (
    sheets.find((s) => s.entry.documentType === documentType && s.entry.default === true)
      ?.entry ?? null
  );
}

export function listSheets(): readonly ClientSheetEntry[] {
  return sheets.map((s) => s.entry);
}

export function clearSheets(): void {
  sheets.length = 0;
  ownerByType.clear();
  for (const [type, owner] of Object.entries(BASE_TYPE_OWNERS)) {
    ownerByType.set(type, owner);
  }
}