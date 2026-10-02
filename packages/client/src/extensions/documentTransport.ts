import { DocumentUpdateRejection, type DocumentUpdateRejectionReason } from "@rollforge/extension-api";

//  Paso 16 §4 — HTTP → DocumentUpdateRejection translation. Lives in its
// own module so bootstrap.test.ts can import it without triggering the
// extension bootstrap side effects (registerSheet, documentUpdated handler).
//
// Translation table (matches packages/server/src/db/documentRoutes.ts):
//   200                  → ok, returns parsed body
//   403 forbidden        → "forbidden"
//   404 not-found        → "not-found"
//   409 stale-rev        → "stale-rev"
//   409 migration-blocked→ "migration-blocked" + { id }
//   503 extension-not-ready → "extension-not-ready" + { type }
//   any 2xx/4xx/5xx      → "network-error"
//   fetch throws / body parse fails → "network-error"
//
// ponytail: this is the only file in the host that owns the error-shape
// contract. Server changes that add new status codes / error strings
// require a corresponding branch here AND a case in bootstrap.test.ts.

export type ErrorBody = { error?: string; type?: string; id?: string } | undefined;

export interface PatchResult {
  ok: true;
  body: unknown;
}

export async function httpPatchDocument(
  id: string,
  patch: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<PatchResult> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/documents/${encodeURIComponent(id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  } catch {
    throw new DocumentUpdateRejection("network-error");
  }

  let body: ErrorBody = undefined;
  let bodyParseFailed = false;
  try {
    body = (await res.json()) as ErrorBody;
  } catch {
    bodyParseFailed = true;
  }

  if (res.ok) {
    return { ok: true, body };
  }

  // ponytail: a non-2xx with an unparseable body can't be classified into a
  // typed reason — the contract guarantees `body.error` for every known
  // status. Fall back to network-error so the test for §4 stays honest.
  if (bodyParseFailed) {
    throw new DocumentUpdateRejection("network-error");
  }

  const reason = body?.error;
  switch (res.status) {
    case 403:
      throw new DocumentUpdateRejection("forbidden");
    case 404:
      throw new DocumentUpdateRejection("not-found");
    case 409:
      if (reason === "migration-blocked") {
        // ponytail: prefer the body's id when present; the server echoes the
        // same id today, but binding to the response makes the contract
        // explicit and survives server-side renames.
        const meta: Record<string, unknown> = {};
        if (typeof body?.id === "string") meta.id = body.id;
        throw new DocumentUpdateRejection("migration-blocked", meta);
      }
      if (reason === "stale-rev") {
        throw new DocumentUpdateRejection("stale-rev");
      }
      // ponytail: unmapped 409 — surface as network-error so the bootstrap.test.ts
      // exhaustive table fails first when the server adds a new status.
      throw new DocumentUpdateRejection("network-error");
    case 503:
      if (reason === "extension-not-ready") {
        throw new DocumentUpdateRejection("extension-not-ready", { type: body?.type });
      }
      throw new DocumentUpdateRejection("network-error");
    default:
      throw new DocumentUpdateRejection("network-error");
  }
}

// ponytail: exported so bootstrap.ts can call the same translator used in
// tests. Keeps the table in one place and prevents drift.
export type { DocumentUpdateRejectionReason };
