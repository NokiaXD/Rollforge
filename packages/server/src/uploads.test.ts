import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { createRollforgeServer, listen, type RollforgeServer } from "./server";

interface HttpResp {
  status: number;
  body: string;
  raw?: Buffer;
  setCookie?: string | undefined;
  headers?: IncomingHttpHeaders;
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
        resolve({
          status: res.statusCode ?? 0,
          body: buf.toString("utf8"),
          raw: buf,
          setCookie,
          headers: res.headers,
        });
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

  // The declared MIME is client-controlled, so bytes decide. A mismatch must be a
  // 400, never a silent re-label into a served image.
  it("rejects bytes that do not match the declared type", async () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>").toString("base64");
    const r = await request(port, "POST", "/api/uploads", {
      data: `data:image/png;base64,${html}`,
      name: "evil.png",
    }, gmCookie);
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error).toBe("content-mismatch");
  });

  it("rejects a PNG body declared as jpg", async () => {
    const r = await request(port, "POST", "/api/uploads", {
      data: `data:image/jpg;base64,${TINY_PNG_B64}`,
      name: "x.jpg",
    }, gmCookie);
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error).toBe("content-mismatch");
  });

  it("writes into an explicit per-world uploads dir", async () => {
    const worldAssets = join(dataDir, "worlds", "w1", "assets");
    await server.close();
    server = createRollforgeServer({ dataDir, uploadsDir: worldAssets, auth: { cookieSecure: false } });
    port = await listen(server, 0);

    const r = await request(port, "POST", "/api/uploads", {
      data: `data:image/png;base64,${TINY_PNG_B64}`,
      name: "map.png",
    }, gmCookie);
    expect(r.status).toBe(200);
    const { url } = JSON.parse(r.body) as { url: string };
    expect(existsSync(join(worldAssets, url.replace(/^\/uploads\//, "")))).toBe(true);
    // Nothing landed in the process-global dir (the first server in beforeEach
    // already created it, so assert the file is absent, not the dir).
    expect(
      existsSync(join(dataDir, "uploads", url.replace(/^\/uploads\//, ""))),
    ).toBe(false);
  });

  it("serves stored images with nosniff", async () => {
    const r = await request(port, "POST", "/api/uploads", {
      data: `data:image/png;base64,${TINY_PNG_B64}`,
      name: "map.png",
    }, gmCookie);
    const { url } = JSON.parse(r.body) as { url: string };
    const fetched = await request(port, "GET", url, undefined, undefined, true);
    expect(fetched.headers?.["x-content-type-options"]).toBe("nosniff");
  });

  it("rejects an oversized body on Content-Length before buffering it", async () => {
    // 20MB of junk: the guard must answer 413 without the JSON parser ever running.
    const big = "A".repeat(20 * 1024 * 1024);
    const r = await request(port, "POST", "/api/uploads", { data: big, name: "big.png" }, gmCookie);
    expect(r.status).toBe(413);
    expect(JSON.parse(r.body).error).toBe("too-large");
  });
});
