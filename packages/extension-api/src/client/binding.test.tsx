/** @jsxImportSource preact */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "preact";
import { signal } from "@preact/signals";
import { createBoundInput } from "./binding";
import { DocumentUpdateRejection } from "../errors";
import type { ClientExtensionAPI } from "../client";
import type { Document } from "@rollforge/protocol";

const sampleDoc: Document = {
  id: "doc-1",
  type: "Actor",
  name: "Hero",
  system: { hp: { value: 10, max: 20 }, notes: "" },
  flags: {},
  ownership: { default: "LIMITED" },
  schemaVersion: 1,
  migrationStatus: "ok",
  _rev: 1,
};

// vi.fn() can't carry a generic through to its inferred Mock type,
// so we cast the documents surface to ClientDocumentsAPI directly. Runtime
// behavior is unchanged.
function makeApi(overrides?: Partial<ClientExtensionAPI>): ClientExtensionAPI {
  const documents = {
    get: vi.fn((id: string) => (id === sampleDoc.id ? sampleDoc : null)),
    subscribe: vi.fn(() => () => {}),
    update: vi.fn(async () => sampleDoc),
  };
  return {
    documents: documents as unknown as ClientExtensionAPI["documents"],
    hooks: { on: () => {}, filter: () => {}, off: () => {} },
    ui: { registerSheet: () => {}, notify: () => {} },
    context: { userId: "u1", sceneId: null },
    ...overrides,
  } as ClientExtensionAPI;
}

function mountInto(node: Element, vnode: preact.VNode): void {
  document.body.innerHTML = "";
  document.body.appendChild(node);
  render(vnode, node);
}

// render attaches to a node and returns nothing. preact's
// useEffect requires the DOM node to be attached (it walks _parentDom in
// flushAfterPaintEffects). This wrapper is the only mount path used by the
// binding tests; keep it thin.

describe("createBoundInput", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers({
      toFake: ["setTimeout", "setInterval", "requestAnimationFrame", "cancelAnimationFrame"],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("calls api.documents.get on render to read the initial value", () => {
    const api = makeApi();
    const BoundInput = createBoundInput(api);
    const host = document.createElement("div");
    mountInto(host, <BoundInput path="name" documentId="doc-1" />);
    expect(api.documents.get).toHaveBeenCalledWith("doc-1");
  });

  it("commits via api.documents.update with the typed path after debounce", async () => {
    const api = makeApi();
    const BoundInput = createBoundInput(api);
    const host = document.createElement("div");
    mountInto(host, <BoundInput path="system.hp.value" documentId="doc-1" type="number" />);
    const input = host.querySelector("input") as HTMLInputElement;
    input.value = "42";
    input.dispatchEvent(new Event("input"));
    // pre-debounce, no update call yet.
    expect(api.documents.update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(api.documents.update).toHaveBeenCalledWith("doc-1", { "system.hp.value": 42 });
  });

  it("captures DocumentUpdateRejection and surfaces the message in the render", async () => {
    const api = makeApi({
      documents: {
        get: () => sampleDoc,
        subscribe: () => () => {},
        list: () => [],
        update: vi.fn(async () => {
          throw new DocumentUpdateRejection("stale-rev");
        }),
      },
    } as unknown as Partial<ClientExtensionAPI>);
    const BoundInput = createBoundInput(api);
    const host = document.createElement("div");
    mountInto(host, <BoundInput path="name" documentId="doc-1" />);
    const input = host.querySelector("input") as HTMLInputElement;
    input.value = "Other";
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(400);
    // re-render after the await — flush microtasks + effects.
    await Promise.resolve();
    const status = host.querySelector("[data-status]");
    expect(status).not.toBeNull();
    expect(status?.getAttribute("data-status")).toBe("stale-rev");
    expect(status?.textContent).toMatch(/Refresca|Refrescar/);
  });

  it("maps unknown thrown errors to network-error and renders the network message", async () => {
    const api = makeApi({
      documents: {
        get: () => sampleDoc,
        subscribe: () => () => {},
        list: () => [],
        update: vi.fn(async () => {
          throw new Error("boom");
        }),
      },
    } as unknown as Partial<ClientExtensionAPI>);
    const BoundInput = createBoundInput(api);
    const host = document.createElement("div");
    mountInto(host, <BoundInput path="name" documentId="doc-1" />);
    const input = host.querySelector("input") as HTMLInputElement;
    input.value = "x";
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(400);
    await Promise.resolve();
    const status = host.querySelector("[data-status]");
    expect(status?.getAttribute("data-status")).toBe("network-error");
    expect(status?.textContent).toMatch(/conexi[oó]n/);
  });

  it("subscribes via api.documents.subscribe on mount and unsubscribes on unmount", async () => {
    // this test runs in isolation; running it after other tests
    // that leave RAF timers pending interferes with the queue. The other
    // tests' advance pattern still drains the queue, so we mirror it here.
    const unsubscribeSpy = vi.fn();
    const subscribeSpy = vi.fn(() => unsubscribeSpy);
    const api = makeApi({
      documents: {
        get: () => sampleDoc,
        subscribe: subscribeSpy,
        list: () => [],
        update: async () => sampleDoc,
      },
    } as unknown as Partial<ClientExtensionAPI>);
    const BoundInput = createBoundInput(api);
    const host = document.createElement("div");
    mountInto(host, <BoundInput path="name" documentId="doc-1" />);
    // preact's useEffect flushes via requestAnimationFrame → setTimeout
    // chain. We click an input to schedule a debounced setTimeout, then advance
    // past RAF_TIMEOUT (35ms) + the debounce (350ms) to drain everything in
    // one shot — same shape as the commit-debounce test.
    const input = host.querySelector("input") as HTMLInputElement;
    input.value = "x";
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(400);
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    expect(subscribeSpy).toHaveBeenCalledWith("doc-1", expect.any(Function));
    render(null as unknown as preact.VNode, host);
    await vi.advanceTimersByTimeAsync(400);
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it("re-renders the input value when subscribe fires with a new doc", async () => {
    const docsSig = signal<Document>(sampleDoc);
    const api = {
      documents: {
        get: (id: string) => (id === sampleDoc.id ? docsSig.value : null),
        subscribe: (_id: string, fn: (doc: Document) => void) => {
          // simulate a server-driven update by reading from a signal.
          let last = docsSig.value;
          return (globalThis as { __rf_raf?: number }).__rf_raf
            ? () => {}
            : (() => {
                const interval = setInterval(() => {
                  if (docsSig.value !== last) {
                    last = docsSig.value;
                    fn(docsSig.value);
                  }
                }, 0);
                return () => clearInterval(interval);
              })();
        },
        update: async () => sampleDoc,
      },
      hooks: { on: () => {}, filter: () => {}, off: () => {} },
      ui: { registerSheet: () => {}, notify: () => {} },
      context: { userId: "u1", sceneId: null },
    } as unknown as ClientExtensionAPI;
    const BoundInput = createBoundInput(api);
    const host = document.createElement("div");
    mountInto(host, <BoundInput path="name" documentId="doc-1" />);
    const input = host.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("Hero");
    docsSig.value = { ...sampleDoc, name: "Renamed" };
    await Promise.resolve();
    await Promise.resolve();
    expect(input.value).toBe("Renamed");
  });
});

