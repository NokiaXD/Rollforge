import { Router, type Request, type Response } from "express";
import type { Server as SocketIOServer } from "socket.io";
import type { Document } from "@rollforge/protocol";
import type { DocumentStore } from "./documentStore";
import { requireAuth, requireGm } from "../auth/middleware";
import type { ExtensionManager } from "../extensions/manager";
import { isExtensionReady, isMigrationUnblocked, isReadOnlyType } from "./documentsGate";

//  tiny path setter; arrays inferred from numeric segments.
export function setInPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> | unknown[] = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const nextKey = parts[i + 1]!;
    const child = (cur as any)[key];
    if (child === null || child === undefined || typeof child !== "object") {
      const fresh = /^\d+$/.test(nextKey) ? [] : {};
      (cur as any)[key] = fresh;
    }
    cur = (cur as any)[key];
  }
  (cur as Record<string, unknown>)[parts[parts.length - 1]!] = value;
}

export interface DocumentRoutesOpts {
  store: DocumentStore | null;
  io: SocketIOServer;
  extensionManager?: ExtensionManager;
}

export interface DocumentUpdatedEvent {
  type: "DocumentUpdated";
  document: Document;
}

function broadcast(io: SocketIOServer, doc: Document): void {
  io.to("world").emit("documentUpdated", { type: "DocumentUpdated", document: doc });
}

export function createDocumentRouter(opts: DocumentRoutesOpts): Router {
  const router = Router();

  router.get("/", requireAuth, (req: Request, res: Response) => {
    if (!opts.store) return res.status(503).json({ error: "store-unavailable" });
    const type = typeof req.query.type === "string" && req.query.type ? req.query.type : null;
    res.json(type ? opts.store.getByType(type) : []);
  });

  router.get("/:id", requireAuth, async (req: Request, res: Response) => {
    if (!opts.store) return res.status(503).json({ error: "store-unavailable" });
    const id = req.params.id ?? "";
    // Lazy migration on read (§12): compendium entries are migrated the
    // first time someone looks at them, not at extension activation. A
    // failed chain does NOT fail the read — Paso 15 fixes that the document
    // gets migration_status='blocked' + a snapshot and the extension stays
    // Active; the reader sees the partially-migrated document with that flag
    // and writes against it stay blocked by the 409 gate in PATCH.
    const doc = opts.extensionManager
      ? await opts.extensionManager.migrateIfStale(id)
      : opts.store.getById(id);
    if (!doc) return res.status(404).json({ error: "not-found" });
    res.json(doc);
  });

  router.post("/", requireAuth, requireGm, async (req: Request, res: Response) => {
    if (!opts.store) return res.status(503).json({ error: "store-unavailable" });
    const input = req.body as Partial<Document> | undefined;

    //  A client must never be able to name the schemaVersion of a document
    //  it creates. save() resolves `input.schemaVersion ?? resolver(type)`,
    //  so a "schemaVersion": 99 in the body would ride straight through the
    //  spread below and claim a document is already migrated when it isn't
    //  (skipping every future chain), or force it backwards (so the next
    //  lazy read re-runs a chain that doesn't need to run). Destructure the
    //  key away ONCE, before the create/import fork, so neither branch can
    //  inherit it by accident. The import branch then sets it explicitly
    //  from the source document.
    const { schemaVersion: _clientVersion, ...fields } = (input ?? {}) as Partial<Document> & {
      sourceId?: string;
    };

    // ---- import: copy an existing document into a new id/type -----------
    // The client sends { id, type, sourceId, name?, ownership? } and NO
    // system. The host resolves the source, migrates it if stale, and only
    // then copies it — so an import can never carry a half-migrated system,
    // regardless of what the client believes it is holding.
    if (typeof fields.sourceId === "string") {
      if (!opts.extensionManager) {
        return res.status(503).json({ error: "extension-not-ready", type: fields.type });
      }
      const source = await opts.extensionManager.migrateIfStale(fields.sourceId);
      if (!source) return res.status(404).json({ error: "not-found" });
      if (source.migrationStatus === "blocked") {
        return res.status(409).json({ error: "migration-blocked", id: source.id });
      }
      if (
        typeof fields.id !== "string" ||
        typeof fields.type !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(fields.id)
      ) {
        return res.status(400).json({ error: "bad-request" });
      }
      // §12: a document whose version is NEWER than the target type knows is
      // never interpreted. The source is already at its own type's target, so
      // this only triggers when the pack's type has moved ahead of the
      // campaign type — there is no up-migration path from "too new".
      const target = opts.extensionManager.currentSchemaVersion(fields.type);
      if (target !== undefined && source.schemaVersion > target) {
        return res.status(409).json({
          error: "schema-too-new",
          source: source.schemaVersion,
          target,
        });
      }
      if (!opts.extensionManager.isTypeReady(fields.type)) {
        return res.status(503).json({ error: "extension-not-ready", type: fields.type });
      }
      // Importing INTO a compendium type would just produce another
      // read-only pack entry; the source is the only thing that should be
      // there.
      if (isReadOnlyType(opts.extensionManager, fields.type)) {
        return res.status(403).json({ error: "read-only", type: fields.type });
      }
      try {
        // Born at the SOURCE's version (that is the version the content
        // actually is), then walked up to the target's current version by
        // the target's own chain below.
        const doc = opts.store.save({
          ...fields,
          id: fields.id,
          type: fields.type,
          name: fields.name ?? source.name,
          system: source.system,
          flags: source.flags,
          ownership: fields.ownership ?? { default: "LIMITED" },
          schemaVersion: source.schemaVersion,
        } as Omit<Document, "_rev">);
        const final =
          (await opts.extensionManager.migrateIfStale(doc.id)) ?? doc;
        broadcast(opts.io, final);
        res.status(201).json(final);
      } catch {
        res.status(409).json({ error: "id-exists" });
      }
      return;
    }

    // ---- normal create -------------------------------------------------
    if (
      !input ||
      typeof input.id !== "string" ||
      typeof input.type !== "string" ||
      typeof input.name !== "string" ||
      typeof input.system !== "object" ||
      input.system === null
    ) {
      return res.status(400).json({ error: "bad-request" });
    }
    // Validate id format: only safe characters, no path segments or control
    // chars. SQLite parameterized queries are not at risk, but a path-like id
    // could break future code that uses the id in a file path or URL segment.
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.id)) {
      return res.status(400).json({ error: "bad-request", detail: "id must match [a-zA-Z0-9_-]{1,128}" });
    }
    if (opts.extensionManager) {
      if (isReadOnlyType(opts.extensionManager, input.type)) {
        return res.status(403).json({ error: "read-only", type: input.type });
      }
      if (!isExtensionReady(opts.extensionManager, input.type)) {
        return res.status(503).json({ error: "extension-not-ready", type: input.type });
      }
    }
    try {
      const doc = opts.store.save(fields as Omit<Document, "_rev">);
      broadcast(opts.io, doc);
      res.status(201).json(doc);
    } catch {
      res.status(409).json({ error: "id-exists" });
    }
  });

  router.patch("/:id", requireAuth, (req: Request, res: Response) => {
    if (!opts.store) return res.status(503).json({ error: "store-unavailable" });
    const id = req.params.id ?? "";
    const existing = opts.store.getById(id);
    if (!existing) return res.status(404).json({ error: "not-found" });
    const username = req.user?.sub;
    const isGM = req.user?.role === "GM";
    const ownership = existing.ownership as Record<string, string>;
    const isOwner = !!username && ownership[username] === "OWNER";
    if (!isGM && !isOwner) return res.status(403).json({ error: "forbidden" });
    if (
      opts.extensionManager &&
      isReadOnlyType(opts.extensionManager, existing.type)
    ) {
      return res.status(403).json({ error: "read-only", type: existing.type });
    }
    if (
      opts.extensionManager &&
      !isExtensionReady(opts.extensionManager, existing.type)
    ) {
      return res.status(503).json({ error: "extension-not-ready", type: existing.type });
    }
    if (!isMigrationUnblocked(opts.store, id)) {
      return res.status(409).json({ error: "migration-blocked", id });
    }
    const patches = (req.body ?? {}) as Record<string, unknown>;
    const draft = JSON.parse(JSON.stringify(existing)) as Document;
    for (const [path, value] of Object.entries(patches)) {
      setInPath(draft as unknown as Record<string, unknown>, path, value);
    }
    try {
      const updated = opts.store.update(draft, existing._rev);
      broadcast(opts.io, updated);
      res.json(updated);
    } catch {
      res.status(409).json({ error: "stale-rev" });
    }
  });

  //  GM-only and deliberately un-ownership-aware: deleting a document is a GM
  //  operation, an OWNER player edits but never destroys.
  router.delete("/:id", requireAuth, requireGm, (req: Request, res: Response) => {
    if (!opts.store) return res.status(503).json({ error: "store-unavailable" });
    const id = req.params.id ?? "";
    const existing = opts.store.getById(id);
    if (!existing) return res.status(404).json({ error: "not-found" });
    if (opts.extensionManager && isReadOnlyType(opts.extensionManager, existing.type)) {
      return res.status(403).json({ error: "read-only", type: existing.type });
    }
    if (!opts.store.delete(id)) return res.status(404).json({ error: "not-found" });
    opts.io.to("world").emit("documentDeleted", { type: "DocumentDeleted", id });
    res.status(204).end();
  });

  return router;
}