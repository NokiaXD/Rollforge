import { Router, type Request, type Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { requireAuth } from "../auth/middleware";
import type { ExtensionManager } from "../extensions/manager";

export interface ExtensionSource {
  id: string;
  url: string;
}

export interface ExtensionSourcesResponse {
  sources: ExtensionSource[];
}

export interface ExtensionSourcesRouterOpts {
  extensionManager: ExtensionManager;
}

// GET /api/extension-sources — serves the list of client-side extensions and
// their individual ESM JS entry files (§Paso 17 §3.5).
export function createExtensionSourcesRouter(opts: ExtensionSourcesRouterOpts): Router {
  const router = Router();

  router.get("/", requireAuth, (_req: Request, res: Response) => {
    const sources: ExtensionSource[] = [];
    for (const ext of opts.extensionManager.list()) {
      if (ext.entry.manifest.main?.client && ext.entry.root) {
        sources.push({
          id: ext.id,
          url: `/api/extension-sources/${ext.id}.js`,
        });
      }
    }
    sources.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    res.setHeader("Cache-Control", "no-store");
    const body: ExtensionSourcesResponse = { sources };
    res.json(body);
  });

  router.get("/:id.js", requireAuth, (req: Request, res: Response) => {
    const id = req.params.id;
    if (!id) {
      res.status(404).end();
      return;
    }

    const ext = opts.extensionManager.getExtension(id);
    if (!ext || !ext.entry.manifest.main?.client || !ext.entry.root) {
      res.status(404).end();
      return;
    }

    const rel = ext.entry.manifest.main.client;
    if (rel.startsWith("/") || rel.includes("..")) {
      res.status(404).end();
      return;
    }

    const resolvedRoot = resolve(ext.entry.root);
    const resolvedPath = resolve(resolvedRoot, rel);
    if (!resolvedPath.startsWith(resolvedRoot + sep) && resolvedPath !== resolvedRoot) {
      res.status(404).end();
      return;
    }

    if (!existsSync(resolvedPath)) {
      res.status(404).end();
      return;
    }

    try {
      const content = readFileSync(resolvedPath, "utf8");
      res.setHeader("Content-Type", "application/javascript");
      res.setHeader("Cache-Control", "no-store");
      res.send(content);
    } catch {
      res.status(404).end();
    }
  });

  return router;
}
