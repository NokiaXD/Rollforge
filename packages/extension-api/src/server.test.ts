import { describe, it, expect, vi } from "vitest";
import { freezeServerAPI, deepFreeze, type ServerExtensionAPI } from "./server";
import { HooksEngine } from "./hooks";
import { CommandRejection } from "./errors";

describe("server API freeze", () => {
  it("freezes the api object so internals and nested objects cannot be mutated", () => {
    const api: ServerExtensionAPI = {
      documents: {} as any,
      hooks: {} as any,
      chat: {
        send: async () => {},
        registerCommand: () => {},
      } as any,
      dice: {} as any,
      users: {} as any,
      migrations: {} as any,
      context: { extensionId: "test-ext" },
      errors: { CommandRejection },
    };
    const frozen = freezeServerAPI(api);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.chat)).toBe(true);
    expect(Object.isFrozen(frozen.context)).toBe(true);
    expect(() => {
      (frozen.context as any).extensionId = "modified";
    }).toThrow();
    expect(() => {
      (frozen.chat as any).send = async () => {};
    }).toThrow();
  });

  //  Paso 24 — api.canvas.viewport is an accessor. Reading it during the walk
  //  used to invoke the getter and freeze whatever it returned, which for Pixi
  //  meant freezing the renderer's whole object graph.
  it("skips accessor properties: never invokes the getter, and stays read-only", () => {
    const get = vi.fn(() => ({ engine: { internal: { deep: true } } }));
    const api = { canvas: { get viewport() { return get(); } } };

    const frozen = deepFreeze(api);

    expect(get).not.toHaveBeenCalled();
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.canvas)).toBe(true);
    //  reading is still allowed, and the value is live — the closure decides it
    const live = frozen.canvas.viewport;
    expect(live.engine.internal.deep).toBe(true);
    expect(get).toHaveBeenCalledTimes(1);
    //  ...but the returned value was never frozen, and assignment throws
    //  because the accessor has no setter (strict mode, as ESM always is).
    expect(Object.isFrozen(live.engine.internal)).toBe(false);
    expect(() => {
      (frozen.canvas as any).viewport = null;
    }).toThrow(TypeError);
  });
});

describe("HooksEngine", () => {
  it("notifies listeners on emit with Promise.allSettled and logs errors with ownerId", async () => {
    const engine = new HooksEngine();
    const calls: string[] = [];
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    engine.on("ready", (payload) => {
      calls.push(`l1:${payload}`);
    }, { ownerId: "ext1" });

    engine.on("ready", () => {
      throw new Error("fail");
    }, { ownerId: "ext2" });

    engine.on("ready", (payload) => {
      calls.push(`l3:${payload}`);
    }, { ownerId: "ext3" });

    await engine.emit("ready", "world");
    expect(calls).toEqual(["l1:world", "l3:world"]);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[hook:ready] error from ext2:"),
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it("filters with priority order: descending priority, load order, ownerId", async () => {
    const engine = new HooksEngine();

    // priority 0, registered first
    engine.filter("preChatMessage", (val: any) => ({ ...val, text: val.text + " [p0-a]" }), {
      priority: 0,
      ownerId: "b-ext",
    });
    // priority 10
    engine.filter("preChatMessage", (val: any) => ({ ...val, text: val.text + " [p10]" }), {
      priority: 10,
      ownerId: "c-ext",
    });
    // priority 0, registered second, tie break with ownerId
    engine.filter("preChatMessage", (val: any) => ({ ...val, text: val.text + " [p0-b]" }), {
      priority: 0,
      ownerId: "a-ext",
    });

    const res = await engine.runFilter("preChatMessage", { text: "msg" });
    // p10 runs first, then load index preserves p0-a before p0-b
    expect(res).toEqual({ text: "msg [p10] [p0-a] [p0-b]" });
  });

  it("continues with previous value if a filter throws an exception", async () => {
    const engine = new HooksEngine();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    engine.filter("preChatMessage", (val: any) => ({ ...val, text: val.text + " [1]" }));
    engine.filter("preChatMessage", () => {
      throw new Error("broken filter");
    }, { ownerId: "broken-ext" });
    engine.filter("preChatMessage", (val: any) => ({ ...val, text: val.text + " [3]" }));

    const res = await engine.runFilter("preChatMessage", { text: "start" });
    expect(res).toEqual({ text: "start [1] [3]" });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[hook-filter:preChatMessage] error from broken-ext:"),
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it("cuts the chain and returns null if a filter returns null", async () => {
    const engine = new HooksEngine();
    const thirdSpy = vi.fn((val) => val);

    engine.filter("preChatMessage", (val: any) => ({ ...val, text: val.text + " [1]" }));
    engine.filter("preChatMessage", () => null);
    engine.filter("preChatMessage", thirdSpy);

    const res = await engine.runFilter("preChatMessage", { text: "start" });
    expect(res).toBeNull();
    expect(thirdSpy).not.toHaveBeenCalled();
  });

  it("supports off and clear by ownerId", async () => {
    const engine = new HooksEngine();
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    engine.on("ready", fn1, { ownerId: "extA" });
    engine.on("ready", fn2, { ownerId: "extB" });

    engine.clear("extA");
    await engine.emit("ready", {});
    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).toHaveBeenCalled();

    engine.off("ready", fn2);
    await engine.emit("ready", {});
    expect(fn2).toHaveBeenCalledTimes(1);
  });
});

describe("CommandRejection", () => {
  it("holds the reason and inherits from Error", () => {
    const rej = new CommandRejection("bad-notation");
    expect(rej).toBeInstanceOf(Error);
    expect(rej).toBeInstanceOf(CommandRejection);
    expect(rej.reason).toBe("bad-notation");
    expect(rej.message).toBe("bad-notation");
  });
});

describe("DocumentsAPI.registerMigrations", () => {
  it("lives on the frozen ServerExtensionAPI surface", () => {
    const api: ServerExtensionAPI = {
      documents: {
        get: async () => null,
        create: async (input: any) => input as any,
        update: async (id: string) => ({ id } as any),
        delete: async () => {},
        registerMigrations: () => ({ ok: true }),
      } as any,
      hooks: {} as any,
      chat: { send: async () => {}, registerCommand: () => {} } as any,
      dice: {} as any,
      users: {} as any,
      migrations: {} as any,
      context: { extensionId: "test-ext" },
      errors: { CommandRejection },
    };
    const frozen = freezeServerAPI(api);
    expect(typeof (frozen.documents as any).registerMigrations).toBe("function");
    expect(() => {
      (frozen.documents as any).registerMigrations = () => ({ ok: false, reason: "x" });
    }).toThrow();
  });
});

describe("MigrationsAPI", () => {
  it("lives on the frozen ServerExtensionAPI surface", () => {
    const api: ServerExtensionAPI = {
      documents: {} as any,
      hooks: {} as any,
      chat: { send: async () => {}, registerCommand: () => {} } as any,
      dice: {} as any,
      users: {} as any,
      migrations: {
        listBlocked: async () => [],
        retry: async () => ({ ok: true, fromVersion: 0, toVersion: 0 }),
        review: async () => ({ ok: true, fromVersion: 0, toVersion: 0 }),
      } as any,
      context: { extensionId: "test-ext" },
      errors: { CommandRejection },
    };
    const frozen = freezeServerAPI(api);
    expect(typeof (frozen.migrations as any).listBlocked).toBe("function");
    expect(typeof (frozen.migrations as any).retry).toBe("function");
    expect(typeof (frozen.migrations as any).review).toBe("function");
    expect(() => {
      (frozen.migrations as any).retry = async () => ({ ok: false, atFrom: 0, atTo: 0, error: "x" });
    }).toThrow();
  });
});

// Paso 16 §3.2 / §6 — exhaustive ServerExtensionAPI shape freeze.
describe("ServerExtensionAPI contract", () => {
  function makeFullApi(): ServerExtensionAPI {
    return {
      documents: {
        get: async () => null,
        create: async (input: any) => input as any,
        update: async (id: string) => ({ id } as any),
        delete: async () => {},
        registerMigrations: () => ({ ok: true }),
      },
      hooks: { on: () => {}, filter: () => {}, off: () => {} },
      chat: { send: async () => {}, registerCommand: () => {} },
      dice: {
        roll: async () => ({
          notation: "1d20",
          terms: [],
          modifier: 0,
          total: 0,
        }),
      },
      users: { findByName: () => null },
      migrations: {
        listBlocked: async () => [],
        retry: async () => ({ ok: true, fromVersion: 0, toVersion: 0 }),
        review: async () => ({ ok: true, fromVersion: 0, toVersion: 0 }),
      },
      context: { extensionId: "core:test" },
      errors: { CommandRejection },
    };
  }

  it("exposes exactly the eight documented top-level keys", () => {
    const frozen = freezeServerAPI(makeFullApi());
    expect(Object.keys(frozen).sort()).toEqual([
      "chat",
      "context",
      "dice",
      "documents",
      "errors",
      "hooks",
      "migrations",
      "users",
    ]);
  });

  it("documents surface exposes exactly { get, create, update, delete, registerMigrations }", () => {
    const frozen = freezeServerAPI(makeFullApi());
    expect(Object.keys(frozen.documents).sort()).toEqual([
      "create",
      "delete",
      "get",
      "registerMigrations",
      "update",
    ]);
  });

  it("does not leak `testing` helpers via the frozen runtime API", () => {
    const frozen = freezeServerAPI(makeFullApi()) as unknown as Record<string, unknown>;
    expect(frozen["testing"]).toBeUndefined();
    expect((frozen["documents"] as Record<string, unknown>)?.["runMigration"]).toBeUndefined();
    expect((frozen["chat"] as Record<string, unknown>)?.["runMigration"]).toBeUndefined();
  });

  it("deep-freezes functions so they cannot be reassigned on the surface", () => {
    const frozen = freezeServerAPI(makeFullApi());
    expect(Object.isFrozen(frozen.documents.get)).toBe(true);
    expect(() => {
      (frozen.documents as { get: unknown }).get = async () => null;
    }).toThrow();
  });
});