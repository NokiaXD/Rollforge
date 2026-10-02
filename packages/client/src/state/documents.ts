import { signal, effect } from "@preact/signals";
import type { Document } from "@rollforge/protocol";

export const documents = signal<Map<string, Document>>(new Map());

export function upsertDocument(doc: Document): void {
  const next = new Map(documents.value);
  next.set(doc.id, doc);
  documents.value = next;
}

export function removeDocument(id: string): void {
  const next = new Map(documents.value);
  next.delete(id);
  documents.value = next;
}

export function getDocument<T extends Document = Document>(id: string): T | null {
  return (documents.value.get(id) as T | undefined) ?? null;
}

export function listDocumentsByType(type: string): Document[] {
  return [...documents.value.values()].filter((d) => d.type === type);
}

//  tiny path getter/setter; client-side mirror of server's setInPath.
export function getInPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const k of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

export function setInPath(obj: unknown, path: string, value: unknown): unknown {
  const parts = path.split(".");
  const root = obj && typeof obj === "object" ? structuredClone(obj) : {};
  let cur: Record<string, unknown> | unknown[] = root as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const nextKey = parts[i + 1]!;
    const child = (cur as any)[key];
    if (child === null || child === undefined || typeof child !== "object") {
      const fresh = /^\d+$/.test(nextKey) ? [] : {};
      (cur as any)[key] = fresh;
    }
    cur = (cur as any)[key];
  }
  (cur as Record<string, unknown>)[parts[parts.length - 1]!] = value;
  return root;
}

export async function fetchDocuments(type: string): Promise<Document[]> {
  const res = await fetch(`/api/documents?type=${encodeURIComponent(type)}`, {
    credentials: "include",
  });
  if (!res.ok) return [];
  const list = (await res.json()) as Document[];
  const next = new Map(documents.value);
  for (const doc of list) next.set(doc.id, doc);
  documents.value = next;
  return list;
}

export async function fetchDocument(id: string): Promise<Document | null> {
  const res = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const doc = (await res.json()) as Document;
  upsertDocument(doc);
  return doc;
}

export interface PatchDocumentOptions {
  //  patch is a record of dot-path → new leaf value.
  patch: Record<string, unknown>;
  // If true, broadcast locally too (default). False to suppress local echo when
  // the originating request already broadcast from the server.
  localEcho?: boolean;
}

export async function patchDocument(id: string, opts: PatchDocumentOptions): Promise<Document | null> {
  const res = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts.patch),
  });
  if (!res.ok) return null;
  const doc = (await res.json()) as Document;
  if (opts.localEcho !== false) upsertDocument(doc);
  return doc;
}

// Subscribe to the current value of a document. Calls fn whenever the doc changes
// (or the id changes). Returns an unsubscribe function.  signals only,
// no react state — the consumer re-reads signal.value.
export function subscribeDocument<T extends Document = Document>(
  id: string,
  fn: (doc: T | null) => void,
): () => void {
  let last: T | null = null;
  return effect(() => {
    const doc = (documents.value.get(id) as T | undefined) ?? null;
    if (doc === last) return;
    last = doc;
    fn(doc);
  });
}