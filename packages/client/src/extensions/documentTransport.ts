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
// this is the only file in the host that owns the error-shape
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

  // a non-2xx with an unparseable body can't be classified into a
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
        // prefer the body's id when present; the server echoes the
        // same id today, but binding to the response makes the contract
        // explicit and survives server-side renames.
        const meta: Record<string, unknown> = {};
        if (typeof body?.id === "string") meta.id = body.id;
        throw new DocumentUpdateRejection("migration-blocked", meta);
      }
      if (reason === "stale-rev") {
        throw new DocumentUpdateRejection("stale-rev");
      }
      // unmapped 409 — surface as network-error so the bootstrap.test.ts
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

// exported so bootstrap.ts can call the same translator used in
// tests. Keeps the table in one place and prevents drift.
export type { DocumentUpdateRejectionReason };

//  Paso 25 — the POST half of the §4 translation table, for
//  api.documents.create. Separate from httpPatchDocument because the status
//  sets barely overlap: a create has no stale-rev and no migration-blocked
//  (the document does not exist yet), but it has one failure PATCH cannot
//  produce — 409 id-exists, which is why that reason joined the union.
//  Translation table (matches createDocumentRouter's POST "/"):
//   201                  → ok, returns the parsed document
//   403 forbidden        → "forbidden"
//   403 read-only        → "forbidden" (a compendium-scoped type)
//   409 id-exists        → "id-exists"
//   503 extension-not-ready → "extension-not-ready" + { type }
//   anything else        → "network-error"
export async function httpPostDocument(
  input: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<PatchResult> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/documents`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
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
  // Same reasoning as the PATCH branch: an unparseable error body cannot be
  // classified, so it degrades to network-error instead of guessing a reason.
  if (bodyParseFailed) {
    throw new DocumentUpdateRejection("network-error");
  }

  const reason = body?.error;
  if (res.status === 403) {
    // "forbidden" and "read-only" (a compendium-scoped type) both mean the
    // caller may not write this document, so both land on the same reason.
    throw new DocumentUpdateRejection("forbidden");
  }
  if (res.status === 409 && reason === "id-exists") {
    throw new DocumentUpdateRejection("id-exists");
  }
  if (res.status === 503 && reason === "extension-not-ready") {
    throw new DocumentUpdateRejection("extension-not-ready", { type: body?.type });
  }
  // migration-blocked / schema-too-new are unreachable here: both are
  // properties of an EXISTING document, and create() only reaches the import
  // branch through a `sourceId` the typed input does not carry. They fall to
  // network-error, which is the honest "we did not expect this".
  throw new DocumentUpdateRejection("network-error");
}
