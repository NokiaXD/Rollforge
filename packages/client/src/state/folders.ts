import { signal } from "@preact/signals";
import type { Folder } from "@rollforge/protocol";
import { createFolderRequest } from "../net/socket";

export const folders = signal<Map<string, Folder>>(new Map());

// ponytail: "Nueva carpeta (n)" con el primer n libre; renombrar después desde el menú contextual.
export function createFolder(): void {
  const taken = new Set([...folders.value.values()].map((f) => f.name));
  for (let i = 1; ; i++) {
    const name = `Nueva carpeta (${i})`;
    if (!taken.has(name)) {
      createFolderRequest(crypto.randomUUID(), name);
      return;
    }
  }
}

export function upsertFolder(folder: Folder): void {
  const next = new Map(folders.value);
  next.set(folder.id, folder);
  folders.value = next;
}

export function removeFolder(folderId: string): void {
  if (!folders.value.has(folderId)) return;
  const next = new Map(folders.value);
  next.delete(folderId);
  folders.value = next;
}