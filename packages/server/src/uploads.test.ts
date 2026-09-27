import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { createRollforgeServer, listen, type RollforgeServer } from "./server";

interface HttpResp {
  status: number;
  body: string;
  raw?: Buffer;
  setCookie?: string | undefined;
}

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
  raw: boolean = false,
): Promise<HttpResp> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? "" : JSON.stringify(body);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(data).toString(),
    };
    if (cookie) headers.cookie = cookie;
    const req = httpRequest({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const rawSetCookie = res.headers["set-cookie"];
        const setCookie = Array.isArray(rawSetCookie) ? rawSetCookie.join(",") : rawSetCookie;
        resolve({ status: res.statusCode ?? 0, body: buf.toString("utf8"), raw: buf, setCookie });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function extractCookie(setCookie: string | string[] | undefined, name: string): string | null {
  const raw = Array.isArray(setCookie) ? setCookie.join(",") : setCookie;
  if (!raw) return null;
  for (const part of raw.split(/,(?=[^;]+=)/)) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      const eq = trimmed.indexOf("=");
      return trimmed.slice(0, eq + 1) + trimmed.slice(eq + 1).split(";")[0];
    }
  }
  return null;
}

// 1x1 transparent PNG. Smallest valid PNG, fits the type filter.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("uploads HTTP integration", () => {
  let server: RollforgeServer;
  let port: number;
  let dataDir: string;
  let gmCookie: string;
  let playerCookie: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "rollforge-uploads-"));
    server = createRollforgeServer({ dataDir, auth: { cookieSecure: false } });
    port = await listen(server, 0);

    const reg1 = await request(port, "POST", "/api/auth/register", { username: "alice", password: "pwpwpwpw" });
    const reg2 = await request(port, "POST", "/api/auth/register", { username: "bob", password: "pwpwpwpw" });
    gmCookie = extractCookie(reg1.setCookie, "rf_session")!;
    playerCookie = extractCookie(reg2.setCookie, "rf_session")!;
  });

  afterEach(async () => {
    await server.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("rejects unauthenticated uploads", async () => {
    const r = await request(port, "POST", "/api/uploads", {
      data: `data:image/png;base64,${TINY_PNG_B64}`,
      name: "x.png",
    });
    expect(r.status).toBe(401);
  });

  it("rejects non-GM uploads with 403", async () => {
    const r = await request(port, "POST", "/api/uploads", {
      data: `data:image/png;base64,${TINY_PNG_B64}`,
      name: "x.png",
    }, playerCookie);
    expect(r.status).toBe(403);
  });

  it("accepts a GM PNG upload and serves it back at the returned URL", async () => {
    const r = await request(port, "POST", "/api/uploads", {
      data: `data:image/png;base64,${TINY_PNG_B64}`,
      name: "map.png",
    }, gmCookie);
    expect(r.status).toBe(200);
    const { url } = JSON.parse(r.body) as { url: string };
    expect(url).toMatch(/^\/uploads\/[0-9a-f]+\.png$/);

    const filePath = join(dataDir, "uploads", url.replace(/^\/uploads\//, ""));
    expect(existsSync(filePath)).toBe(true);

    // Static serve returns the bytes (decoded to raw).
    const fetched = await request(port, "GET", url, undefined, undefined, true);
    expect(fetched.status).toBe(200);
    expect(fetched.raw!.length).toBeGreaterThan(0);
  });

  it("rejects payloads that are not data:image/*", async () => {
    const r = await request(port, "POST", "/api/uploads", {
      data: "data:application/zip;base64,xxx",
      name: "evil.zip",
    }, gmCookie);
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error).toBe("bad-format");
  });

  it("rejects unsupported mime types", async () => {
    const r = await request(port, "POST", "/api/uploads", {
      data: "data:image/svg+xml;base64,xxx",
      name: "evil.svg",
    }, gmCookie);
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error).toBe("unsupported-type");
  });
});
