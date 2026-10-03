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
// Delegates to manager.isTypeReady() as the single source of truth — both
// this HTTP-route path and the extension API path (createScopedAPI) use
// the same check, so changing the set of "ready" states only needs one edit.
export function isExtensionReady(
  manager: ExtensionManager,
  type: string,
): boolean {
  return manager.isTypeReady(type);
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

// Paso 18: a documentType declared with scope "compendium" holds one
// read-only document per pack entry. Nobody edits those in place — you
// import the entry into campaign state instead, which produces a NEW
// document of a campaign-scoped type (see the import branch in
// documentRoutes). Without this a GM could fork a pack entry by PATCHing
// it, and the pack would silently diverge from the source JSON.
//
// Deliberately NOT enforced in api.documents.update: the owning extension
// populates its own pack in-process and must be able to write there. The
// extension is server-side code, not an untrusted client; the gate exists
// for the external write paths.
export function isReadOnlyType(
  manager: ExtensionManager,
  type: string,
): boolean {
  return manager.documentTypeRegistry.get(type)?.type.scope === "compendium";
}