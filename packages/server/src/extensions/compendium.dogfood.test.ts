import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRollforgeServer, listen, type RollforgeServer } from "../server";
import type { DocumentStore } from "../db/documentStore";

// Paso 18 end-to-end through the REAL boot path: a real server, the real disk
// loader pointed at this workspace, the real resolver wiring, the real command
// registry. The unit tests use synthetic entries; this one proves the shipped
// manifest, entry files and pack fixture actually work — and that installing
// the compendium costs the boot no migrations at all.
//
// This file lives at packages/server/src/extensions/, so two levels up is
// packages/server and three is packages/ — the workspace root that
// scripts/dev.mjs points ROLLFORGE_EXTENSIONS at.
const EXTENSIONS_DIR = resolve(__dirname, "..", "..", "..");

let server: RollforgeServer;
let port: number;
let dataDir: string;
let store: DocumentStore;

async function boot(): Promise<void> {
  dataDir = mkdtempSync(join(tmpdir(), "rollforge-comp-dogfood-"));
  server = createRollforgeServer({
    dataDir,
    auth: { cookieSecure: false },
    extensionsDir: EXTENSIONS_DIR,
  });
  port = await listen(server, 0);
  const s = server.store;
  if (!s) throw new Error("server built without a store");
  store = s;
  // Boot activation is fire-and-forget (loadExtensions → dispatchActivationEvent),
  // so wait for the state instead of racing it.
  await vi.waitFor(() => {
    expect(server.extensions.getExtension("compendium")?.state).toBe("Active");
  });
}

// Each test gets a fresh dataDir, so the first registered user is the GM.
async function registerGm(username: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "pwpwpwpw" }),
  });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  if (!cookie) throw new Error(`registration failed: ${res.status}`);
  return cookie;
}

async function runCommand(text: string): Promise<void> {
  // getContributedCommand returns metadata only; the handler lives in the
  // ChatCommandRegistry, which is the object the chat path invokes.
  const registered = server.extensions.commandRegistry.get("compendio");
  if (!registered) throw new Error("the /compendio command was not registered");
  await registered.handler({ args: text.split(/\s+/), rest: text }, { userId: "gm-1", isGM: true });
}

describe("compendium extension, booted from disk", () => {
  beforeEach(boot);

  afterEach(async () => {
    await server.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("boots Active with both document types and the scopes the design depends on", () => {
    const types = server.extensions.documentTypeRegistry.list();
    const pack = types.find((t) => t.type.id === "compendium-actor");
    const campaign = types.find((t) => t.type.id === "compendium-monster");
    expect(pack?.type.scope).toBe("compendium");
    // The campaign type has NO scope (the default "campaign"). That default is
    // the only reason an imported monster is editable at all.
    expect(campaign?.type.scope).toBeUndefined();
    expect(server.extensions.currentSchemaVersion("compendium-actor")).toBe(2);
    expect(server.extensions.currentSchemaVersion("compendium-monster")).toBe(2);
  });

  it("load materialises the pack at each entry's own version and migrates NOTHING", async () => {
    await runCommand("load demo-monsters");

    const ids = store.getByType("compendium-actor").map((d) => d.id);
    expect(ids).toHaveLength(9);
    expect(ids).toContain("pack-demo-monsters-goblin");

    // The whole point of scope:"compendium". If this ever flips to 2,
    // installing a pack is doing thousands of migrations at boot again.
    expect(store.getById("pack-demo-monsters-goblin")?.schemaVersion).toBe(2);
    expect(store.getById("pack-demo-monsters-old-troll")?.schemaVersion).toBe(1);
    expect(store.getById("pack-demo-monsters-legendary-mimic")?.schemaVersion).toBe(0);
  });

  it("load is idempotent", async () => {
    await runCommand("load demo-monsters");
    await runCommand("load demo-monsters");
    expect(store.getByType("compendium-actor")).toHaveLength(9);
  });

  it("the lazy path brings each entry to the chain target on first open", async () => {
    await runCommand("load demo-monsters");

    // A v1 entry: one step, cr derived from ac.
    const troll = await server.extensions.migrateIfStale<{ cr: number }>(
      "pack-demo-monsters-old-troll",
    );
    expect(troll?.schemaVersion).toBe(2);
    expect(troll?.system.cr).toBe(1);

    // A v0 entry: both steps, with ac backfilled by 0→1.
    const mimic = await server.extensions.migrateIfStale<{ ac: number; cr: number }>(
      "pack-demo-monsters-legendary-mimic",
    );
    expect(mimic?.schemaVersion).toBe(2);
    expect(mimic?.system.ac).toBe(10);
    expect(mimic?.system.cr).toBe(0);
  });

  it("an unknown pack is rejected instead of half-loading", async () => {
    await expect(runCommand("load nope")).rejects.toThrow(/Pack desconocido/);
    expect(store.getByType("compendium-actor")).toHaveLength(0);
  });

  it("the pack entries are read-only over HTTP, and the wire type carries the scope", async () => {
    await runCommand("load demo-monsters");
    const cookie = await registerGm("gmrw");

    const patch = await fetch(`http://127.0.0.1:${port}/api/documents/pack-demo-monsters-goblin`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "hacked" }),
    });
    expect(patch.status).toBe(403);
    expect(await patch.json()).toEqual({ error: "read-only", type: "compendium-actor" });

    const types = await fetch(`http://127.0.0.1:${port}/api/document-types`, {
      headers: { cookie },
    });
    const body = (await types.json()) as { types: Array<{ id: string; scope: string }> };
    expect(body.types.find((t) => t.id === "compendium-actor")?.scope).toBe("compendium");
  });

  it("imports over the real HTTP route: the copy is campaign state, editable, and at the target version", async () => {
    await runCommand("load demo-monsters");
    const cookie = await registerGm("gmimp");

    // The client sends a REFERENCE, not a copy: no `system` in the body.
    const res = await fetch(`http://127.0.0.1:${port}/api/documents`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        id: "monster-imported-1",
        type: "compendium-monster",
        sourceId: "pack-demo-monsters-old-troll",
        ownership: { default: "LIMITED" },
      }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      type: string;
      schemaVersion: number;
      system: { cr: number; ac: number };
    };
    expect(created.type).toBe("compendium-monster");
    expect(created.schemaVersion).toBe(2);
    // cr only exists because the source was migrated on the way in.
    expect(created.system.cr).toBe(1);
    expect(created.system.ac).toBe(15);

    // And the imported monster is ordinary campaign state: editable.
    const patch = await fetch(`http://127.0.0.1:${port}/api/documents/monster-imported-1`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ "system.ac": 16 }),
    });
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as { system: { ac: number } }).system.ac).toBe(16);
  });
});
