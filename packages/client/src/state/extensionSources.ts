import { signal } from "@preact/signals";

//  mirror of the server's DocumentTypeRegistry for client-side sheet
// ownership checks. Populated once at bootstrap from
// /api/document-types via fetchDocumentTypes(). Server is the source of
// truth — this signal is observability; clientSheets.setOwnerMap owns the
// authoritative client-side table.

export interface DocumentTypeEntry {
  id: string;
  extensionId: string;
  base: "Actor" | "Item" | "Scene";
  schemaVersion: number;
  // The server always reports it (documentTypesRoute.ts), defaulting omitted
  // manifest scopes to "campaign". Optional here only for test fixtures.
  scope?: "campaign" | "compendium";
}

export const documentTypes = signal<readonly DocumentTypeEntry[]>([]);

// Fetches the registry snapshot the server has at this moment. Returns an
// empty list on any failure (anon user, network down, 401) — the bootstrap
// continues either way; sheets for unknown types simply fail to register.
export async function fetchDocumentTypes(
  fetchImpl: typeof fetch = fetch,
): Promise<readonly DocumentTypeEntry[]> {
  try {
    const res = await fetchImpl("/api/document-types", { credentials: "include" });
    if (!res.ok) {
      documentTypes.value = [];
      return [];
    }
    const body = (await res.json()) as { types: DocumentTypeEntry[] };
    documentTypes.value = body.types;
    return body.types;
  } catch {
    documentTypes.value = [];
    return [];
  }
}