import { Router, type Request, type Response, type NextFunction } from "express";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { requireAuth, requireGm } from "./auth/middleware";

const ALLOWED_TYPES = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const MAX_SIZE = 10 * 1024 * 1024;
// base64 inflates 4/3, plus a little slack for the JSON envelope around the data URL.
const MAX_REQUEST_BYTES = Math.ceil((MAX_SIZE * 4) / 3) + 1024;

// Real content sniff. The declared MIME is client-controlled, so bytes decide:
// a mismatch is a 400, never a silent re-label (a .html body must not become a .png).
function matchesMagic(buf: Buffer, ext: string): boolean {
  switch (ext) {
    case "png":
      return (
        buf.length >= 8 &&
        buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
        buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
      );
    case "jpg":
      return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case "gif":
      return (
        buf.length >= 6 &&
        (buf.toString("latin1", 0, 6) === "GIF87a" || buf.toString("latin1", 0, 6) === "GIF89a")
      );
    case "webp":
      return (
        buf.length >= 12 &&
        buf.toString("latin1", 0, 4) === "RIFF" &&
        buf.toString("latin1", 8, 12) === "WEBP"
      );
    default:
      return false;
  }
}

// Reject oversized uploads on Content-Length, BEFORE express.json buffers the body.
// Self-hosted servers run on laptops; an upload we are going to refuse must never be
// paid for in memory. Content-Length is absent on chunked bodies, so MAX_SIZE after
// decode stays as the backstop.
export function rejectOversizedUpload(req: Request, res: Response, next: NextFunction): void {
  const len = req.headers["content-length"];
  if (len !== undefined) {
    const bytes = Number(len);
    if (Number.isFinite(bytes) && bytes > MAX_REQUEST_BYTES) {
      res.status(413).json({ error: "too-large" });
      return;
    }
  }
  next();
}

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
  // we base64-in-JSON to avoid pulling multer/busboy. 10MB cap is plenty for maps.
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
    if (!matchesMagic(buf, ext)) {
      res.status(400).json({ error: "content-mismatch" });
      return;
    }
    const hash = randomBytes(16).toString("hex");
    const filename = `${hash}.${ext}`;
    writeFileSync(join(opts.dir, filename), buf);
    res.json({ url: `/uploads/${filename}` });
  });

  return router;
}
