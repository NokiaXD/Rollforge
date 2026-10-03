import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadClientExtensions } from "./extensionLoader";
import { clearSheets, sheetsFor, setOwnerMap, registerSheet } from "./clientSheets";
import type { ClientExtensionAPI } from "@rollforge/extension-api";

function createMockAPI(extId: string): ClientExtensionAPI {
  return {
    documents: {
      get: () => null,
      subscribe: () => () => {},
      update: async () => ({} as never),
    },
    hooks: {
      on: () => {},
      filter: () => {},
      off: () => {},
    },
    ui: {
      registerSheet: (opts) => {
        registerSheet({
          documentType: opts.documentType,
          component: opts.component as never,
          default: opts.default,
          extensionId: extId,
        });
      },
      notify: () => {},
    },
    context: {
      userId: "user-1",
      sceneId: null,
    },
  };
}

describe("client extension loader", () => {
  beforeEach(() => {
    clearSheets();
  });

  it("returns empty result when server returns no sources", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sources: [] }),
    });

    const result = await loadClientExtensions((id) => createMockAPI(id), mockFetch as never);
    expect(result).toEqual({ loaded: [], failed: [] });
  });

  it("returns failed when fetch rejects or is not ok", async () => {
    const mockFetchFail = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await loadClientExtensions((id) => createMockAPI(id), mockFetchFail as never);
    expect(result).toEqual({
      loaded: [],
      failed: [{ id: "sources", error: "fetch-failed" }],
    });

    const mockFetchNetworkError = vi.fn().mockRejectedValue(new Error("network blip"));
    const result2 = await loadClientExtensions((id) => createMockAPI(id), mockFetchNetworkError as never);
    expect(result2).toEqual({
      loaded: [],
      failed: [{ id: "sources", error: "fetch-failed" }],
    });
  });

  it("loads working sources and captures broken one in failed", async () => {
    setOwnerMap({
      "type-a": "ext-a",
      "type-b": "ext-b",
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sources: [
          { id: "ext-a", url: "/api/extension-sources/ext-a.js" },
          { id: "ext-broken", url: "/api/extension-sources/ext-broken.js" },
          { id: "ext-b", url: "/api/extension-sources/ext-b.js" },
        ],
      }),
    });

    const mockImport = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("ext-a")) {
        return {
          default: (api: ClientExtensionAPI) => {
            api.ui.registerSheet({
              documentType: "type-a",
              component: (() => null) as never,
              default: true,
            });
          },
        };
      }
      if (url.includes("ext-broken")) {
        throw new Error("SyntaxError: unexpected token in extension");
      }
      if (url.includes("ext-b")) {
        return {
          activate: (api: ClientExtensionAPI) => {
            api.ui.registerSheet({
              documentType: "type-b",
              component: (() => null) as never,
              default: true,
            });
          },
        };
      }
      throw new Error("unknown url");
    });

    const result = await loadClientExtensions(
      (id) => createMockAPI(id),
      mockFetch as never,
      mockImport,
    );

    expect(result.loaded).toEqual(["ext-a", "ext-b"]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.id).toBe("ext-broken");
    expect(result.failed[0]?.error).toContain("SyntaxError");

    // Both ext-a and ext-b sheets registered correctly
    expect(sheetsFor("type-a")).toHaveLength(1);
    expect(sheetsFor("type-b")).toHaveLength(1);
  });
});
