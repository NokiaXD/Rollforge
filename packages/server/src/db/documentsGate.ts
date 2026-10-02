import type { ExtensionManager } from "../extensions/manager";
import type { DocumentStore } from "./documentStore";

//  gates described in Paso 15 §12. They are pure, side-effect free
// helpers used by both the documents API surface (extension path) and the
// HTTP routes (GM path). Keeping them together avoids the two paths
// diverging on "what counts as ready".

// Returns the extensionId that owns this documentType, or undefined if the
// type is base (Actor/Item/Scene) or not contributed at all.
export function ownerOfType(
  manager: ExtensionManager,
  type: string,
): string | undefined {
  return manager.documentTypeRegistry.get(type)?.extensionId;
}

// Returns true when either no extension owns this type (base types like
// Actor/Item/Scene never gate) or the owning extension is in Active state.
// Caller should reject writes with extension-not-ready when this is false.
export function isExtensionReady(
  manager: ExtensionManager,
  type: string,
): boolean {
  const ownerId = ownerOfType(manager, type);
  if (!ownerId) return true;
  return manager.getExtension(ownerId)?.state === "Active";
}

// Returns true when the doc does not exist (no gate needed for a fresh
// create target) or its migration_status is 'ok'. blocked docs are read-only
// until the GM clears the flag via the /migrations admin command.
export function isMigrationUnblocked(
  store: DocumentStore,
  id: string,
): boolean {
  const row = store.getById(id);
  if (!row) return true;
  return row.migrationStatus === "ok";
}