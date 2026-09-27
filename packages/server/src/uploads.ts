import { Router, type Request, type Response } from "express";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { requireAuth, requireGm } from "./auth/middleware";

const ALLOWED_TYPES = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const MAX_SIZE = 10 * 1024 * 1024;

export interface UploadsOpts {
  // absolute or cwd-relative dir; we don't resolve to keep server cwd-agnostic.
  dir: string;
}

export function ensureUploadsDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function createUploadsRouter(opts: UploadsOpts): Router {
  ensureUploadsDir(opts.dir);
  const router = Router();

  // Accepts JSON { data: "data:image/png;base64,...", name?: "map.png" }.
  // ponytail: we base64-in-JSON to avoid pulling multer/busboy. 10MB cap is plenty for maps.
  router.post("/", requireAuth, requireGm, (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { data?: unknown; name?: unknown };
    if (typeof body.data !== "string" || !body.data.startsWith("data:image/")) {
      res.status(400).json({ error: "bad-format" });
      return;
    }
    const match = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/.exec(body.data);
    if (!match) {
      res.status(400).json({ error: "bad-format" });
      return;
    }
    const mimeType = match[1]!;
    const ext = mimeType === "jpeg" ? "jpg" : mimeType;
    if (!ALLOWED_TYPES.has(ext)) {
      res.status(400).json({ error: "unsupported-type" });
      return;
    }
    const buf = Buffer.from(match[2]!, "base64");
    if (buf.length > MAX_SIZE) {
      res.status(413).json({ error: "too-large" });
      return;
    }
    const hash = randomBytes(16).toString("hex");
    const filename = `${hash}.${ext}`;
    writeFileSync(join(opts.dir, filename), buf);
    res.json({ url: `/uploads/${filename}` });
  });

  return router;
}
