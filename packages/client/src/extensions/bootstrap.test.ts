import { describe, it, expect, vi, afterEach } from "vitest";
import { DocumentUpdateRejection } from "@rollforge/extension-api";
import { httpPatchDocument } from "./documentTransport";
import { bootstrapClient, waitForApi } from "./bootstrap";
import { setAuthenticated, setAnon } from "../state/auth";

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

describe("waitForApi", () => {
  it("retries while the connection is refused and resolves once it answers", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new TypeError("fetch failed");
      return { status: 401, ok: false } as unknown as Response;
    }) as unknown as typeof fetch;
    const sleep = vi.fn(async () => {});
    await expect(waitForApi(fetchImpl, sleep)).resolves.toBe(true);
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("gives up after the budget and reports the API as never up", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const sleep = vi.fn(async () => {});
    await expect(waitForApi(fetchImpl, sleep)).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(60);
  });
});

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

describe("bootstrapClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setAnon();
  });

  it("defers extension loading until the session is authenticated", async () => {
    const urls: string[] = [];
    let authed = false;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url === "/api/auth/me") {
        return (
          authed
            ? { status: 200, ok: true, json: async () => ({ username: "gm", role: "GM" }) }
            : { status: 401, ok: false, json: async () => ({ error: "unauthorized" }) }
        ) as Response;
      }
      if (!authed) return { status: 401, ok: false, json: async () => ({ error: "unauthorized" }) } as Response;
      if (url === "/api/document-types") return { status: 200, ok: true, json: async () => ({ types: [] }) } as Response;
      if (url === "/api/extension-sources") return { status: 200, ok: true, json: async () => ({ sources: [] }) } as Response;
      return { status: 404, ok: false, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);

    await bootstrapClient();
    // anon: both endpoints are behind requireAuth, so nothing was even asked
    expect(urls).not.toContain("/api/document-types");
    expect(urls).not.toContain("/api/extension-sources");

    // the login form flips authStatus → the watcher runs the deferred load
    authed = true;
    setAuthenticated({ username: "gm", role: "GM" });
    await vi.waitFor(() => expect(urls).toContain("/api/extension-sources"));
    expect(urls).toContain("/api/document-types");
  });
});
