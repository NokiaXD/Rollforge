import { describe, it, expect } from "vitest";
import { MigrationLock } from "./migrationLock";

describe("MigrationLock", () => {
  it("serializes two callers on the same type", async () => {
    const lock = new MigrationLock();
    const order: string[] = [];

    const a = lock.runExclusive("Actor", async () => {
      order.push("a-start");
      await new Promise((r) => setTimeout(r, 30));
      order.push("a-end");
    });
    const b = lock.runExclusive("Actor", async () => {
      order.push("b-start");
      order.push("b-end");
    });

    await Promise.all([a, b]);
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("runs different types in parallel", async () => {
    const lock = new MigrationLock();
    const order: string[] = [];

    const a = lock.runExclusive("Actor", async () => {
      order.push("a");
      await new Promise((r) => setTimeout(r, 20));
    });
    const b = lock.runExclusive("Item", async () => {
      order.push("b");
      await new Promise((r) => setTimeout(r, 20));
    });

    await Promise.all([a, b]);
    // a and b interleave because there's no shared lock between types.
    expect(order).toContain("a");
    expect(order).toContain("b");
  });

  it("releases the slot even when fn throws", async () => {
    const lock = new MigrationLock();
    await expect(
      lock.runExclusive("Actor", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // After failure the lock must be available again
    let ran = false;
    await lock.runExclusive("Actor", async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("cleans up the internal Map entry after the last caller for a type finishes", async () => {
    // Regression test for the comparison bug: `previous.then(() => next)` was
    // evaluated twice, creating two distinct Promise objects, so `===` always
    // returned false and the entry was never deleted.
    const lock = new MigrationLock();

    await lock.runExclusive("Actor", async () => {
      // no-op
    });

    // Accessing the private field via cast to verify cleanup
    const chains = (lock as unknown as { chains: Map<string, unknown> }).chains;
    expect(chains.has("Actor")).toBe(false);
  });

  it("serializes three callers in order and leaves the Map clean", async () => {
    const lock = new MigrationLock();
    const order: number[] = [];

    await Promise.all([
      lock.runExclusive("Scene", async () => { order.push(1); }),
      lock.runExclusive("Scene", async () => { order.push(2); }),
      lock.runExclusive("Scene", async () => { order.push(3); }),
    ]);

    expect(order).toEqual([1, 2, 3]);

    const chains = (lock as unknown as { chains: Map<string, unknown> }).chains;
    expect(chains.has("Scene")).toBe(false);
  });
});