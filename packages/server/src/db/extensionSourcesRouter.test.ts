import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { createRollforgeServer, listen, type RollforgeServer } from "../server";
import type { ExtensionSourcesResponse } from "./extensionSourcesRouter";
import type { ExtensionManifest } from "@rollforge/protocol";

interface HttpResp {
  status: number;
  body: string;
  setCookie?: string | undefined;
  contentType?: string | undefined;
}

function request(
  port: number,
  method: string,
  path: string,
  cookie?: string,
): Promise<HttpResp> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (cookie) headers.cookie = cookie;
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const rawSetCookie = res.headers["set-cookie"];
          const setCookie = Array.isArray(rawSetCookie) ? rawSetCookie.join(",") : rawSetCookie;
          resolve({
            status: res.statusCode ?? 0,
            body: buf.toString("utf8"),
            setCookie,
            contentType: res.headers["content-type"],
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function extractCookie(setCookie: string | undefined, name: string): string | null {
  if (!setCookie) return null;
  for (const part of setCookie.split(/,(?=[^;]+=)/)) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      const eq = trimmed.indexOf("=");
      return trimmed.slice(0, eq + 1) + trimmed.slice(eq + 1).split(";")[0];
    }
  }
  return null;
}

function regBody(
  port: number,
  username: string,
  password: string,
): Promise<HttpResp> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ username, password });
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/api/auth/register",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(data).toString(),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const rawSetCookie = res.headers["set-cookie"];
          const setCookie = Array.isArray(rawSetCookie) ? rawSetCookie.join(",") : rawSetCookie;
          resolve({
            status: res.statusCode ?? 0,
            body: buf.toString("utf8"),
            setCookie,
            contentType: res.headers["content-type"],
          });
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function loginAsGM(port: number, seq: number): Promise<string> {
  const username = `gm${seq}`;
  const reg = await regBody(port, username, "pwpwpwpw");
  const cookie = extractCookie(reg.setCookie, "rf_session");
  if (!cookie) throw new Error("registration did not return a session");
  return cookie;
}

describe("/api/extension-sources", () => {
  let server: RollforgeServer;
  let port: number;
  let dataDir: string;
  let extDir: string;
  let gmCookie: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "rollforge-sources-"));
    extDir = mkdtempSync(join(tmpdir(), "rollforge-ext-sources-"));
    server = createRollforgeServer({ dataDir, auth: { cookieSecure: false } });
    port = await listen(server, 0);
    gmCookie = await loginAsGM(port, Math.floor(Math.random() * 1e6));
  });

  afterEach(async () => {
    await server.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(extDir, { recursive: true, force: true });
  });

  it("rejects unauthenticated requests with 401", async () => {
    const r = await request(port, "GET", "/api/extension-sources");
    expect(r.status).toBe(401);
  });

  it("returns an empty sources list when no extension contributes main.client", async () => {
    const r = await request(port, "GET", "/api/extension-sources", gmCookie);
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body) as ExtensionSourcesResponse;
    expect(body.sources).toEqual([]);
  });

  it("returns sources with url when extensions have main.client and root", () => {
    const clientJsPath = join(extDir, "client.js");
    writeFileSync(clientJsPath, "export default function activate() {}");

    const manifest: ExtensionManifest = {
      id: "test-client-ext",
      name: "Test Client Ext",
      version: "0.1.0",
      engines: { core: ">=0.1.0" },
      activationEvents: ["onReady"],
      main: { client: "client.js" },
    };

    server.extensions.registerExtension({
      manifest,
      root: extDir,
    });

    return request(port, "GET", "/api/extension-sources", gmCookie).then((r) => {
      expect(r.status).toBe(200);
      const body = JSON.parse(r.body) as ExtensionSourcesResponse;
      expect(body.sources).toEqual([
        {
          id: "test-client-ext",
          url: "/api/extension-sources/test-client-ext.js",
        },
      ]);
    });
  });

  it("does not include extensions without main.client", () => {
    const manifest: ExtensionManifest = {
      id: "server-only-ext",
      name: "Server Only",
      version: "0.1.0",
      engines: { core: ">=0.1.0" },
      activationEvents: ["onReady"],
      main: { server: "server.js" },
    };

    server.extensions.registerExtension({
      manifest,
      root: extDir,
    });

    return request(port, "GET", "/api/extension-sources", gmCookie).then((r) => {
      expect(r.status).toBe(200);
      const body = JSON.parse(r.body) as ExtensionSourcesResponse;
      expect(body.sources).toEqual([]);
    });
  });

  it("serves JS file with application/javascript content type and matching content", async () => {
    const clientCode = "console.log('client loaded'); export default function() {}";
    const clientJsPath = join(extDir, "main.client.js");
    writeFileSync(clientJsPath, clientCode);

    const manifest: ExtensionManifest = {
      id: "serve-ext",
      name: "Serve Ext",
      version: "0.1.0",
      engines: { core: ">=0.1.0" },
      activationEvents: ["onReady"],
      main: { client: "main.client.js" },
    };

    server.extensions.registerExtension({
      manifest,
      root: extDir,
    });

    const r = await request(port, "GET", "/api/extension-sources/serve-ext.js", gmCookie);
    expect(r.status).toBe(200);
    expect(r.contentType).toContain("application/javascript");
    expect(r.body).toBe(clientCode);
  });

  it("returns 404 for unknown extension id or missing file", async () => {
    const r404 = await request(port, "GET", "/api/extension-sources/nonexistent.js", gmCookie);
    expect(r404.status).toBe(404);
  });

  it("returns 404 when main.client escapes the extension folder (path traversal attempt)", async () => {
    const subDir = join(extDir, "sub");
    mkdirSync(subDir, { recursive: true });

    const manifest: ExtensionManifest = {
      id: "traversal-ext",
      name: "Traversal Ext",
      version: "0.1.0",
      engines: { core: ">=0.1.0" },
      activationEvents: ["onReady"],
      main: { client: "../secret.txt" },
    };

    // Even if somehow registered with an escaping path, the router must 404
    server.extensions.registerExtension({
      manifest,
      root: subDir,
    });

    const r = await request(port, "GET", "/api/extension-sources/traversal-ext.js", gmCookie);
    expect(r.status).toBe(404);
  });
});
