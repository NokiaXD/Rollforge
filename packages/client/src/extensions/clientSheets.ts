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

const sheets: InternalSheetEntry[] = [];
const ownerByType = new Map<string, string>();

export function registerSheet(entry: ClientSheetEntry): void {
  // First-ever registration for a type sets the owner. Without an extensionId,
  // the slot is owned by "<unnamed>" — anonymous ownership is allowed, but two
  // anonymous registrations for the same type still conflict (see below).
  if (!ownerByType.has(entry.documentType)) {
    ownerByType.set(entry.documentType, entry.extensionId ?? "");
  }
  const ownerId = ownerByType.get(entry.documentType)!;
  const newId = entry.extensionId ?? "";

  if (entry.default !== true) {
    sheets.push({ entry });
    return;
  }

  const existingIdx = sheets.findIndex(
    (s) => s.entry.documentType === entry.documentType && s.entry.default === true,
  );

  if (existingIdx === -1) {
    sheets.push({ entry });
    return;
  }

  const existing = sheets[existingIdx]!;

  // Same owner can override silently and keep a one-deep history for restoration.
  // Anyone else gets an explicit error — same class as the server's SheetRegistry
  // (see SheetOwnerConflict in @rollforge/protocol). Mirrors §16's policy.
  if (newId !== ownerId) {
    throw new SheetOwnerConflict(entry.documentType, ownerId, newId);
  }

  sheets[existingIdx] = { entry, previousDefault: existing.entry };
}

export function clearSheetsFor(extensionId: string): void {
  for (let i = sheets.length - 1; i >= 0; i--) {
    const s = sheets[i]!;
    if (s.entry.extensionId !== extensionId) continue;
    if (s.previousDefault) {
      // Restore the prior default. Ownership transfers to whoever the restored
      // entry belongs to (or "" if anonymous). previousDefault is consumed — a
      // chain doesn't grow on repeated override→deactivate cycles.
      const restored = s.previousDefault;
      sheets[i] = { entry: restored, previousDefault: undefined };
      ownerByType.set(s.entry.documentType, restored.extensionId ?? "");
    } else {
      sheets.splice(i, 1);
    }
  }
  // If the deactivated extension was the original owner of a type and nothing
  // remains for that type, drop the ownership so a later extension can claim it.
  for (const [type, owner] of [...ownerByType]) {
    if (owner !== extensionId) continue;
    const remaining = sheets.some((s) => s.entry.documentType === type);
    if (!remaining) ownerByType.delete(type);
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
}