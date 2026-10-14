import { describe, it, expect } from "vitest";
import { freezeClientAPI, deepFreeze, type ClientExtensionAPI, type ClientDocumentsAPI, type ClientUIAPI } from "./client";
import { DocumentUpdateRejection, type DocumentUpdateRejectionReason } from "./errors";
import { HooksEngine } from "./hooks";

function makeApi(): ClientExtensionAPI {
  const documents: ClientDocumentsAPI = {
    get: <T extends { id: string } = never>(_id: string) => null as T | null,
    subscribe: <T extends { id: string } = never>(_id: string, _fn: (doc: T) => void) => () => {},
    update: async <T extends { id: string } = never>(_id: string, _patch: Partial<T>) => ({}) as T,
    list: <T extends { id: string } = never>(_type: string) => [] as readonly T[],
    create: async <T extends { id: string } = never>(_input: Omit<T, "_rev" | "schemaVersion">) =>
      ({}) as T,
  };
  const ui: ClientUIAPI = {
    registerSheet: () => {},
    registerPanel: () => {},
    notify: () => {},
    openDocument: () => {},
    openModal: () => {},
    openContextMenu: () => {},
    closeModal: () => {},
    imagePicker: () => null,
    preact: {
      h: (() => null) as never,
      Fragment: (() => null) as never,
      useState: (() => []) as never,
      useRef: (() => ({ current: null })) as never,
      useEffect: () => {},
      useMemo: (() => null) as never,
      useCallback: (() => null) as never,
    },
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
    context: { userId: "u1", sceneId: null, role: "GM" },
    canvas: {
      viewport: null,
      pixi: { Container: class {}, Graphics: class {}, Text: class {} },
      onReady: () => {},
    },
    scene: {
      cellSize: () => 50,
      cellLength: () => 5,
      units: () => "ft",
      tokens: () => [],
    },
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

  it("exposes exactly the six top-level keys", () => {
    const frozen = freezeClientAPI(makeApi());
    //  `canvas` + `scene` added in Paso 24 (the `ruler` extension). §13 covers
    //  the shape of `api` under semver, so the contract is asserted here.
    expect(Object.keys(frozen).sort()).toEqual([
      "canvas",
      "context",
      "documents",
      "hooks",
      "scene",
      "ui",
    ]);
  });

  it("canvas surface exposes exactly { onReady, pixi, viewport }", () => {
    const frozen = freezeClientAPI(makeApi());
    expect(Object.keys(frozen.canvas).sort()).toEqual(["onReady", "pixi", "viewport"]);
    expect(Object.keys(frozen.canvas.pixi).sort()).toEqual(["Container", "Graphics", "Text"]);
  });

  it("viewport surface exposes exactly { addChild, off, on, removeChild, toWorld }", () => {
    //  the drawing escape hatch, minus any way to reach the Pixi class itself.
    const vp = {
      toWorld: () => ({ x: 0, y: 0 }),
      addChild: () => null,
      off: () => {},
      removeChild: () => null,
      on: () => {},
    };
    const frozen = freezeClientAPI({
      ...makeApi(),
      canvas: { viewport: vp, pixi: { Container: class {}, Graphics: class {}, Text: class {} }, onReady: () => {} },
    });
    expect(frozen.canvas.viewport).not.toBeNull();
    expect(Object.keys(frozen.canvas.viewport as object).sort()).toEqual([
      "addChild",
      "off",
      "on",
      "removeChild",
      "toWorld",
    ]);
  });

  it("scene surface exposes exactly { cellLength, cellSize, tokens, units }", () => {
    const frozen = freezeClientAPI(makeApi());
    expect(Object.keys(frozen.scene).sort()).toEqual(["cellLength", "cellSize", "tokens", "units"]);
  });

  it("documents surface exposes exactly { create, get, list, subscribe, update }", () => {
    const frozen = freezeClientAPI(makeApi());
    // `list` added in Paso 18: an extension cannot show a browser over a
    // collection of documents without a way to enumerate them, and a client
    // extension has no HTTP client of its own. `create` in Paso 25: a panel
    // cannot offer "make me a character" without it.
    expect(Object.keys(frozen.documents).sort()).toEqual([
      "create",
      "get",
      "list",
      "subscribe",
      "update",
    ]);
  });

  it("ui surface exposes exactly { closeModal, imagePicker, notify, openContextMenu, openDocument, openModal, registerPanel, registerSheet }", () => {
    const frozen = freezeClientAPI(makeApi());
    // `registerPanel` added in Paso 18: the first extension-owned surface
    // that is not a modal sheet. `openDocument` in Paso 25: the way a panel
    // hands a row to the sheet. `openModal`/`closeModal` in CPR: an extension
    // rendered its own `fixed inset-0` inside a sidebar, where the sidebar is
    // the containing block and the panel clips it. `openContextMenu` in CPR:
    // same reason, one level down — a row with N actions used to need N
    // buttons painted next to it. §13 covers the shape of `api` under semver,
    // so the contract is asserted here and each addition is deliberate.
    // `imagePicker` in CPR: the first extension needed an image upload and a
    // token-shaped cut, and every extension that uploads a picture afterwards
    // wants the identical thing.
    expect(Object.keys(frozen.ui).sort()).toEqual([
      "closeModal",
      "imagePicker",
      "notify",
      "openContextMenu",
      "openDocument",
      "openModal",
      "registerPanel",
      "registerSheet",
    ]);
  });

  it("context carries the caller's role, so a panel can hide GM-only controls", () => {
    // documents.create is requireGm server-side; without this an extension
    // can only render the button and surface the 403 afterwards.
    expect(freezeClientAPI(makeApi()).context.role).toBe("GM");
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

  it("supports all seven reasons from the contract", () => {
    const reasons: DocumentUpdateRejectionReason[] = [
      "forbidden",
      "extension-not-ready",
      "migration-blocked",
      "stale-rev",
      "not-found",
      "id-exists",
      "network-error",
    ];
    for (const reason of reasons) {
      const rej = new DocumentUpdateRejection(reason);
      expect(rej.reason).toBe(reason);
      expect(rej).toBeInstanceOf(DocumentUpdateRejection);
    }
  });
});
