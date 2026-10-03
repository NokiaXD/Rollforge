import { describe, it, expect, beforeEach } from "vitest";
import { h } from "preact";
import type { Document } from "@rollforge/protocol";
import type { ClientExtensionAPI, ClientPanelRegistration } from "@rollforge/extension-api";
import {
  clearPanels,
  clearPanelsFor,
  listPanels,
  panelEntries,
  panelFor,
  registerPanel,
} from "./clientPanels";
import { documents, upsertDocument } from "../state/documents";

function fakeApi(id: string): ClientExtensionAPI {
  return { context: { userId: id, sceneId: null } } as unknown as ClientExtensionAPI;
}

function panel(id: string, documentTypes?: string[]): ClientPanelRegistration {
  return {
    id,
    title: `Panel ${id}`,
    component: (() => h("div", null, "x")) as ClientPanelRegistration["component"],
    ...(documentTypes ? { documentTypes } : {}),
  };
}

function doc(id: string, type: string): Document {
  return {
    id,
    type,
    name: id,
    system: {},
    flags: {},
    ownership: {},
    schemaVersion: 0,
    migrationStatus: "ok",
    _rev: 0,
  };
}

describe("client panel registry", () => {
  beforeEach(() => {
    clearPanels();
    documents.value = new Map();
  });

  it("registers a panel and hands its own api back to the host", () => {
    const api = fakeApi("ext-a");
    registerPanel({ panel: panel("compendium", ["pack-actor"]), api, extensionId: "ext-a" });
    const found = panelFor("compendium");
    expect(found?.extensionId).toBe("ext-a");
    expect(found?.api).toBe(api);
    expect(found?.panel.title).toBe("Panel compendium");
  });

  it("last registration wins for a duplicate id, and reports it", () => {
    const warnings: string[] = [];
    registerPanel({ panel: panel("dup"), api: fakeApi("ext-a"), extensionId: "ext-a" });
    registerPanel(
      { panel: panel("dup"), api: fakeApi("ext-b"), extensionId: "ext-b" },
      (m) => warnings.push(m),
    );
    expect(listPanels().filter((p) => p.panel.id === "dup")).toHaveLength(1);
    expect(panelFor("dup")?.extensionId).toBe("ext-b");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/already registered/);
  });

  it("refuses a panel id that shadows a core sidebar tab", () => {
    const warnings: string[] = [];
    registerPanel({ panel: panel("actors"), api: fakeApi("ext-a"), extensionId: "ext-a" }, (m) =>
      warnings.push(m),
    );
    // It would otherwise mount stacked on top of the core Actores view.
    expect(panelFor("actors")).toBeUndefined();
    expect(listPanels()).toHaveLength(0);
    expect(warnings[0]).toMatch(/collides with a core sidebar tab/);
  });

  it("clearPanelsFor removes only that extension's panels", () => {
    registerPanel({ panel: panel("a"), api: fakeApi("ext-a"), extensionId: "ext-a" });
    registerPanel({ panel: panel("b"), api: fakeApi("ext-b"), extensionId: "ext-b" });
    clearPanelsFor("ext-a");
    expect(panelFor("a")).toBeUndefined();
    expect(panelFor("b")).toBeDefined();
  });

  it("panelEntries flattens the declared documentTypes from the signal store", () => {
    const p = panel("compendium", ["pack-actor", "pack-item"]);
    upsertDocument(doc("pack-1", "pack-actor"));
    upsertDocument(doc("pack-2", "pack-actor"));
    upsertDocument(doc("pack-3", "pack-item"));
    upsertDocument(doc("actor-1", "Actor"));
    const ids = panelEntries(p).map((d) => d.id).sort();
    expect(ids).toEqual(["pack-1", "pack-2", "pack-3"]);
  });

  it("panelEntries is empty for a panel with no declared types", () => {
    upsertDocument(doc("pack-1", "pack-actor"));
    expect(panelEntries(panel("bare"))).toEqual([]);
  });
});
