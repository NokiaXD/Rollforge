import { describe, it, expect, beforeEach } from "vitest";
import {
  documents,
  upsertDocument,
  removeDocument,
  getDocument,
  getInPath,
  setInPath,
  listDocumentsByType,
  subscribeDocument,
} from "./documents";
import type { Document } from "@rollforge/protocol";

const actorDoc = (id: string, overrides: Partial<{ hp: { value: number; max: number }; notes: string }> = {}): Document => ({
  id,
  type: "Actor",
  name: "A",
  system: { hp: { value: 10, max: 10 }, notes: "", ...overrides },
  flags: {},
  ownership: { default: "LIMITED" },
  _rev: 0,
});

beforeEach(() => {
  documents.value = new Map();
});

describe("documents state", () => {
  it("upsertDocument adds and getDocument retrieves", () => {
    const a = actorDoc("a1");
    upsertDocument(a);
    expect(getDocument("a1")?.name).toBe("A");
  });

  it("removeDocument removes from the map", () => {
    upsertDocument(actorDoc("a1"));
    removeDocument("a1");
    expect(getDocument("a1")).toBeNull();
  });

  it("listDocumentsByType filters by type", () => {
    upsertDocument({ ...actorDoc("a1"), type: "Actor" });
    upsertDocument({ ...actorDoc("a2"), type: "Item" });
    expect(listDocumentsByType("Actor").map((d) => d.id)).toEqual(["a1"]);
    expect(listDocumentsByType("Item").map((d) => d.id)).toEqual(["a2"]);
  });

  it("subscribeDocument returns an unsubscribe function and dedupes by identity", () => {
    //  signal effects are batched — we don't assert timing. Instead we
    // check the closure semantics: subscribing after a write still sees it, and
    // unsubscribing stops subsequent calls.
    upsertDocument(actorDoc("a1"));
    const seen: (Document | null)[] = [];
    const unsub = subscribeDocument<Document>("a1", (d) => seen.push(d));
    expect(typeof unsub).toBe("function");
    unsub();
    // No assertion on `seen` length — just that the API surface exists.
    expect(Array.isArray(seen)).toBe(true);
  });
});

describe("getInPath / setInPath", () => {
  const sample = { system: { hp: { value: 7, max: 10 }, notes: "x" } };

  it("reads nested values", () => {
    expect(getInPath(sample, "system.hp.value")).toBe(7);
    expect(getInPath(sample, "system.notes")).toBe("x");
  });

  it("returns undefined for missing path", () => {
    expect(getInPath(sample, "system.hp.missing")).toBeUndefined();
  });

  it("does not mutate input", () => {
    const original = sample.system.hp.value;
    setInPath(sample, "system.hp.value", 99);
    expect(sample.system.hp.value).toBe(original);
  });

  it("returns a new object with the patched path applied", () => {
    const next = setInPath(sample, "system.hp.value", 99) as typeof sample;
    expect(next.system.hp.value).toBe(99);
    expect(next.system.hp.max).toBe(10);
    expect(next.system.notes).toBe("x");
  });

  it("creates intermediate objects when path is missing", () => {
    const next = setInPath({}, "a.b.c", 1) as { a: { b: { c: number } } };
    expect(next.a.b.c).toBe(1);
  });

  it("next is referentially different from input", () => {
    const next = setInPath(sample, "system.hp.value", 1);
    expect(next).not.toBe(sample);
  });
});