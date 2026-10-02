import { describe, it, expect } from "vitest";
import { MigrationRegistry } from "./registry";

const step = (from: number, to: number, up: (s: any) => any = (s) => s) => ({ from, to, up });

describe("MigrationRegistry", () => {
  it("registers a contiguous chain and exposes it by type", () => {
    const reg = new MigrationRegistry();
    const r = reg.register("Actor", [step(1, 2)], 2, "ext-a");
    expect(r.ok).toBe(true);
    expect(reg.has("Actor")).toBe(true);
    expect(reg.get("Actor")?.targetVersion).toBe(2);
    expect(reg.get("Actor")?.extensionId).toBe("ext-a");
  });

  it("accepts an empty chain when targetVersion is 0", () => {
    const reg = new MigrationRegistry();
    expect(reg.register("X", [], 0, "ext").ok).toBe(true);
  });

  it("rejects a chain with a hole", () => {
    const reg = new MigrationRegistry();
    const r = reg.register("Actor", [step(1, 2), step(3, 4)], 4, "ext");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("step 1 starts at");
  });

  it("rejects a step that does not bump by one", () => {
    const reg = new MigrationRegistry();
    const r = reg.register("Actor", [step(1, 3)], 3, "ext");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("not a single-version bump");
  });

  it("rejects a chain whose final version does not match targetVersion", () => {
    const reg = new MigrationRegistry();
    const r = reg.register("Actor", [step(1, 2)], 3, "ext");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("chain ends at 2 but targetVersion is 3");
  });

  it("rejects a second registration of the same type", () => {
    const reg = new MigrationRegistry();
    expect(reg.register("Actor", [step(1, 2)], 2, "a").ok).toBe(true);
    const r = reg.register("Actor", [step(1, 2)], 2, "b");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("already registered by extension \"a\"");
  });

  it("unregisterAll removes chains owned by the given extension id", () => {
    const reg = new MigrationRegistry();
    reg.register("Actor", [step(1, 2)], 2, "a");
    reg.register("Item", [step(1, 2)], 2, "b");
    reg.unregisterAll("a");
    expect(reg.has("Actor")).toBe(false);
    expect(reg.has("Item")).toBe(true);
  });

  it("list returns all registered chains", () => {
    const reg = new MigrationRegistry();
    reg.register("Actor", [step(1, 2)], 2, "a");
    reg.register("Item", [step(1, 2)], 2, "b");
    expect(reg.list()).toHaveLength(2);
  });
});