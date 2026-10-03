import { describe, it, expect, vi } from "vitest";
import { DocumentUpdateRejection } from "@rollforge/extension-api";
import { httpPatchDocument } from "./documentTransport";

interface FakeResponseInit {
  status: number;
  body?: unknown;
  ok?: boolean;
  jsonReject?: boolean;
}

function fakeFetch(init: FakeResponseInit): typeof fetch {
  const ok = init.ok ?? (init.status >= 200 && init.status < 300);
  return vi.fn(async () => {
    const res = {
      ok,
      status: init.status,
      json: async () => {
        if (init.jsonReject) throw new Error("bad json");
        return init.body;
      },
    };
    return res as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("httpPatchDocument translation table", () => {
  it("returns the parsed body on 200", async () => {
    const body = { id: "doc-1", name: "Hero" };
    const fetchImpl = fakeFetch({ status: 200, body });
    const result = await httpPatchDocument("doc-1", { name: "Hero" }, fetchImpl);
    expect(result).toEqual({ ok: true, body });
  });

  it("translates 403 forbidden → DocumentUpdateRejection(forbidden)", async () => {
    const fetchImpl = fakeFetch({ status: 403, body: { error: "forbidden" } });
    await expect(httpPatchDocument("doc-1", {}, fetchImpl)).rejects.toMatchObject({
      reason: "forbidden",
    });
    await expect(httpPatchDocument("doc-1", {}, fetchImpl)).rejects.toBeInstanceOf(
      DocumentUpdateRejection,
    );
  });

  it("translates 404 not-found → DocumentUpdateRejection(not-found)", async () => {
    const fetchImpl = fakeFetch({ status: 404, body: { error: "not-found" } });
    await expect(httpPatchDocument("doc-1", {}, fetchImpl)).rejects.toMatchObject({
      reason: "not-found",
    });
  });

  it("translates 409 stale-rev → DocumentUpdateRejection(stale-rev)", async () => {
    const fetchImpl = fakeFetch({ status: 409, body: { error: "stale-rev" } });
    await expect(httpPatchDocument("doc-1", {}, fetchImpl)).rejects.toMatchObject({
      reason: "stale-rev",
    });
  });

  it("translates 409 migration-blocked with id → reason + meta", async () => {
    const fetchImpl = fakeFetch({
      status: 409,
      body: { error: "migration-blocked", id: "doc-99" },
    });
    let caught: unknown;
    try {
      await httpPatchDocument("doc-1", {}, fetchImpl);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DocumentUpdateRejection);
    const rej = caught as DocumentUpdateRejection;
    expect(rej.reason).toBe("migration-blocked");
    expect(rej.meta).toEqual({ id: "doc-99" });
  });

  it("translates 503 extension-not-ready with type → reason + meta", async () => {
    const fetchImpl = fakeFetch({
      status: 503,
      body: { error: "extension-not-ready", type: "Actor" },
    });
    let caught: unknown;
    try {
      await httpPatchDocument("doc-1", {}, fetchImpl);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DocumentUpdateRejection);
    const rej = caught as DocumentUpdateRejection;
    expect(rej.reason).toBe("extension-not-ready");
    expect(rej.meta).toEqual({ type: "Actor" });
  });

  it("translates unmapped 409 (unknown error string) → network-error", async () => {
    const fetchImpl = fakeFetch({
      status: 409,
      body: { error: "some-future-status" },
    });
    await expect(httpPatchDocument("doc-1", {}, fetchImpl)).rejects.toMatchObject({
      reason: "network-error",
    });
  });

  it("translates unmapped 503 (no extension-not-ready reason) → network-error", async () => {
    const fetchImpl = fakeFetch({
      status: 503,
      body: { error: "store-unavailable" },
    });
    await expect(httpPatchDocument("doc-1", {}, fetchImpl)).rejects.toMatchObject({
      reason: "network-error",
    });
  });

  it("translates unmapped 4xx/5xx → network-error", async () => {
    const fetchImpl = fakeFetch({ status: 500, body: { error: "oops" } });
    await expect(httpPatchDocument("doc-1", {}, fetchImpl)).rejects.toMatchObject({
      reason: "network-error",
    });
  });

  it("translates fetch rejection → network-error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("NetworkError");
    }) as unknown as typeof fetch;
    await expect(httpPatchDocument("doc-1", {}, fetchImpl)).rejects.toMatchObject({
      reason: "network-error",
    });
  });

  it("translates unparseable body on 4xx → network-error", async () => {
    const fetchImpl = fakeFetch({ status: 403, jsonReject: true });
    await expect(httpPatchDocument("doc-1", {}, fetchImpl)).rejects.toMatchObject({
      reason: "network-error",
    });
  });

  it("returns the body verbatim on 200 even when jsonReject is true (response.json throws)", async () => {
    // 200 with an unparseable body shouldn't reject; bootstrap.ts
    // only needs to know the request succeeded. Body remains undefined.
    const fetchImpl = fakeFetch({ status: 200, jsonReject: true });
    const result = await httpPatchDocument("doc-1", {}, fetchImpl);
    expect(result.ok).toBe(true);
    expect(result.body).toBeUndefined();
  });
});
