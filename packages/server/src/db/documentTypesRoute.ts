import { Router, type Response } from "express";
import type { DocumentTypeContribution } from "@rollforge/protocol";
import { requireAuth } from "../auth/middleware";
import type { ExtensionManager } from "../extensions/manager";

export interface DocumentTypeEntry {
  id: string;
  extensionId: string;
  base: DocumentTypeContribution["base"];
  schemaVersion: number;
  scope: DocumentTypeContribution["scope"];
}

export interface DocumentTypesResponse {
  types: DocumentTypeEntry[];
}

export interface DocumentTypesRouterOpts {
  extensionManager: ExtensionManager;
}

// GET /api/document-types — declarative source of truth for document-type
// ownership. The client uses it to populate its ownerByType map so that
// `registerSheet({ default: true })` can validate against the registry
// instead of inferring ownership from call order (§Paso 17 §3.1).
export function createDocumentTypesRouter(opts: DocumentTypesRouterOpts): Router {
  const router = Router();

  router.get("/", requireAuth, (_req, res: Response) => {
    const list = opts.extensionManager.documentTypeRegistry
      .list()
      .map<DocumentTypeEntry>((entry) => ({
        id: entry.type.id,
        extensionId: entry.extensionId,
        base: entry.type.base,
        schemaVersion: entry.type.schemaVersion,
        // Undefined for manifests that omit it; the client treats a missing
        // scope as "campaign" (the default) so this stays a pure observability
        // field and not a second source of truth.
        scope: entry.type.scope ?? "campaign",
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const body: DocumentTypesResponse = { types: list };
    res.json(body);
  });

  return router;
}