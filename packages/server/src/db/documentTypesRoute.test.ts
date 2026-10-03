import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { createRollforgeServer, listen, type RollforgeServer } from "../server";
import type { ExtensionManifest, DocumentTypesResponse } from "./documentTypesRoute";

interface HttpResp {
  status: number;
  body: string;
  setCookie?: string | undefined;
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
          resolve({ status: res.statusCode ?? 0, body: buf.toString("utf8"), setCookie });
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
          resolve({ status: res.statusCode ?? 0, body: buf.toString("utf8"), setCookie });
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

describe("/api/document-types", () => {
  let server: RollforgeServer;
  let port: number;
  let dataDir: string;
  let gmCookie: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "rollforge-doctypes-"));
    server = createRollforgeServer({ dataDir, auth: { cookieSecure: false } });
    port = await listen(server, 0);
    gmCookie = await loginAsGM(port, Math.floor(Math.random() * 1e6));
  });

  afterEach(async () => {
    await server.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("rejects unauthenticated requests with 401", async () => {
    const r = await request(port, "GET", "/api/document-types");
    expect(r.status).toBe(401);
  });

  it("returns an empty list when no extension has contributed documentTypes", () => {
    return request(port, "GET", "/api/document-types", gmCookie).then((r) => {
      expect(r.status).toBe(200);
      const body = JSON.parse(r.body) as DocumentTypesResponse;
      expect(body.types).toEqual([]);
    });
  });

  it("returns one entry per contributed documentType with the owning extensionId", () => {
    const manifest: ExtensionManifest = {
      id: "example-rpg",
      name: "Example RPG",
      version: "0.1.0",
      engines: { core: ">=0.1.0" },
      activationEvents: ["onReady"],
      contributes: {
        documentTypes: [
          { id: "example-character", base: "Actor", schemaVersion: 2 },
        ],
      },
    };
    const result = server.extensions.registerExtension({
      manifest,
      activate: () => {},
    });
    expect(result.ok).toBe(true);

    return request(port, "GET", "/api/document-types", gmCookie).then((r) => {
      expect(r.status).toBe(200);
      const body = JSON.parse(r.body) as DocumentTypesResponse;
      expect(body.types).toEqual([
        {
          id: "example-character",
          extensionId: "example-rpg",
          base: "Actor",
          schemaVersion: 2,
          // Paso 18: manifests that omit scope are reported as "campaign" so
          // the client never has to handle undefined.
          scope: "campaign",
        },
      ]);
    });
  });

  it("reports scope: compendium for read-only pack wrapper types", () => {
    const manifest: ExtensionManifest = {
      id: "compendium-x",
      name: "Compendium X",
      version: "0.1.0",
      engines: { core: ">=0.1.0" },
      activationEvents: ["onReady"],
      contributes: {
        documentTypes: [
          { id: "pack-actor", base: "Actor", schemaVersion: 2, scope: "compendium" },
          { id: "camp-actor", base: "Actor", schemaVersion: 2 },
        ],
      },
    };
    server.extensions.registerExtension({ manifest, activate: () => {} });

    return request(port, "GET", "/api/document-types", gmCookie).then((r) => {
      const body = JSON.parse(r.body) as DocumentTypesResponse;
      expect(body.types.map((t) => [t.id, t.scope])).toEqual([
        ["camp-actor", "campaign"],
        ["pack-actor", "compendium"],
      ]);
    });
  });

  it("sorts entries by id for a stable client contract", () => {
    const manifest: ExtensionManifest = {
      id: "two-types",
      name: "Two Types",
      version: "0.1.0",
      engines: { core: ">=0.1.0" },
      activationEvents: ["onReady"],
      contributes: {
        documentTypes: [
          { id: "zeta-doc", base: "Actor", schemaVersion: 1 },
          { id: "alpha-doc", base: "Item", schemaVersion: 5 },
          { id: "mid-doc", base: "Scene", schemaVersion: 0 },
        ],
      },
    };
    server.extensions.registerExtension({ manifest, activate: () => {} });

    return request(port, "GET", "/api/document-types", gmCookie).then((r) => {
      const body = JSON.parse(r.body) as DocumentTypesResponse;
      expect(body.types.map((t) => t.id)).toEqual(["alpha-doc", "mid-doc", "zeta-doc"]);
      expect(body.types.map((t) => t.schemaVersion)).toEqual([5, 0, 1]);
    });
  });

  it("does not surface base types Actor/Item/Scene (they are not contributed)", () => {
    return request(port, "GET", "/api/document-types", gmCookie).then((r) => {
      const body = JSON.parse(r.body) as DocumentTypesResponse;
      const ids = body.types.map((t) => t.id);
      expect(ids).not.toContain("Actor");
      expect(ids).not.toContain("Item");
      expect(ids).not.toContain("Scene");
    });
  });
});