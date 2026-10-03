import { Router, type Request, type Response } from "express";
import type { Server as SocketIOServer } from "socket.io";
import type { Document } from "@rollforge/protocol";
import type { DocumentStore } from "./documentStore";
import { requireAuth, requireGm } from "../auth/middleware";
import type { ExtensionManager } from "../extensions/manager";
import { isExtensionReady, isMigrationUnblocked } from "./documentsGate";

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

  router.get("/:id", requireAuth, (req: Request, res: Response) => {
    if (!opts.store) return res.status(503).json({ error: "store-unavailable" });
    const doc = opts.store.getById(req.params.id ?? "");
    if (!doc) return res.status(404).json({ error: "not-found" });
    res.json(doc);
  });

  router.post("/", requireAuth, requireGm, (req: Request, res: Response) => {
    if (!opts.store) return res.status(503).json({ error: "store-unavailable" });
    const input = req.body as Partial<Document> | undefined;
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
    if (
      opts.extensionManager &&
      !isExtensionReady(opts.extensionManager, input.type)
    ) {
      return res.status(503).json({ error: "extension-not-ready", type: input.type });
    }
    try {
      const doc = opts.store.save(input as Omit<Document, "_rev">);
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
    if (!opts.store.delete(id)) return res.status(404).json({ error: "not-found" });
    opts.io.to("world").emit("documentDeleted", { type: "DocumentDeleted", id });
    res.status(204).end();
  });

  return router;
}