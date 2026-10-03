import { describe, it, expect } from "vitest";
import { freezeClientAPI, deepFreeze, type ClientExtensionAPI, type ClientDocumentsAPI, type ClientUIAPI } from "./client";
import { DocumentUpdateRejection, type DocumentUpdateRejectionReason } from "./errors";
import { HooksEngine } from "./hooks";

function makeApi(): ClientExtensionAPI {
  const documents: ClientDocumentsAPI = {
    get: <T extends { id: string } = never>(_id: string) => null as T | null,
    subscribe: <T extends { id: string } = never>(_id: string, _fn: (doc: T) => void) => () => {},
    update: async <T extends { id: string } = never>(_id: string, _patch: Partial<T>) => ({}) as T,
  };
  const ui: ClientUIAPI = {
    registerSheet: () => {},
    notify: () => {},
  };
  const hooksEngine = new HooksEngine();
  return {
    documents,
    hooks: {
      on: (event, fn) => hooksEngine.on(event, fn),
      filter: (event, fn, opts) => hooksEngine.filter(event, fn, opts),
      off: (event, fn) => hooksEngine.off(event, fn),
    },
    ui,
    context: { userId: "u1", sceneId: null },
  };
}

describe("freezeClientAPI", () => {
  it("freezes api and nested surfaces so internals cannot be mutated", () => {
    const api = makeApi();
    const frozen = freezeClientAPI(api);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.documents)).toBe(true);
    expect(Object.isFrozen(frozen.ui)).toBe(true);
    expect(Object.isFrozen(frozen.context)).toBe(true);
    expect(() => {
      (frozen.context as { userId: string }).userId = "modified";
    }).toThrow();
  });

  it("freezes deeply, including functions on the documents surface", () => {
    const api = makeApi();
    const frozen = freezeClientAPI(api);
    expect(Object.isFrozen(frozen.documents.get)).toBe(true);
    expect(() => {
      (frozen.documents as { get: unknown }).get = () => null;
    }).toThrow();
  });

  it("exposes exactly the four top-level keys", () => {
    const frozen = freezeClientAPI(makeApi());
    expect(Object.keys(frozen).sort()).toEqual(["context", "documents", "hooks", "ui"]);
  });

  it("documents surface exposes exactly { get, subscribe, update }", () => {
    const frozen = freezeClientAPI(makeApi());
    expect(Object.keys(frozen.documents).sort()).toEqual(["get", "subscribe", "update"]);
  });

  it("ui surface exposes exactly { notify, registerSheet }", () => {
    const frozen = freezeClientAPI(makeApi());
    expect(Object.keys(frozen.ui).sort()).toEqual(["notify", "registerSheet"]);
  });

  it("hooks surface is restricted to { filter, off, on } and does not leak HooksEngine", () => {
    const frozen = freezeClientAPI(makeApi());
    const keys = Object.keys(frozen.hooks).sort();
    expect(keys).toEqual(["filter", "off", "on"]);
    // regression guard — the host builds the engine inside the closure;
    // the public surface must not expose `emit`, `runFilter`, or `clear`.
    const hooksAsAny = frozen.hooks as unknown as Record<string, unknown>;
    expect(hooksAsAny["emit"]).toBeUndefined();
    expect(hooksAsAny["runFilter"]).toBeUndefined();
    expect(hooksAsAny["clear"]).toBeUndefined();
  });
});

describe("deepFreeze", () => {
  it("recurses through nested objects and freezes functions", () => {
    const obj = { a: { b: { c: () => {} } } };
    const frozen = deepFreeze(obj);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.a)).toBe(true);
    expect(Object.isFrozen(frozen.a.b)).toBe(true);
    expect(Object.isFrozen(frozen.a.b.c)).toBe(true);
    expect(() => {
      (frozen.a.b as { c: unknown }).c = () => {};
    }).toThrow();
  });

  it("handles cycles via seen set without throwing", () => {
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = { a };
    a["b"] = b;
    expect(() => deepFreeze(a)).not.toThrow();
  });
});

describe("DocumentUpdateRejection", () => {
  it("is exported from the package main entry and inherits from Error", () => {
    expect(DocumentUpdateRejection).toBeDefined();
    const rej = new DocumentUpdateRejection("forbidden");
    expect(rej).toBeInstanceOf(Error);
    expect(rej).toBeInstanceOf(DocumentUpdateRejection);
    expect(rej.reason).toBe("forbidden");
    expect(rej.message).toBe("forbidden");
    expect(rej.meta).toEqual({});
  });

  it("preserves meta payload", () => {
    const rej = new DocumentUpdateRejection("migration-blocked", { id: "doc-1" });
    expect(rej.reason).toBe<DocumentUpdateRejectionReason>("migration-blocked");
    expect(rej.meta).toEqual({ id: "doc-1" });
  });

  it("supports all six reasons from the contract", () => {
    const reasons: DocumentUpdateRejectionReason[] = [
      "forbidden",
      "extension-not-ready",
      "migration-blocked",
      "stale-rev",
      "not-found",
      "network-error",
    ];
    for (const reason of reasons) {
      const rej = new DocumentUpdateRejection(reason);
      expect(rej.reason).toBe(reason);
      expect(rej).toBeInstanceOf(DocumentUpdateRejection);
    }
  });
});
