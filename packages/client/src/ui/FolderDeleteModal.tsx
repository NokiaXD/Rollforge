import { useEffect, useCallback } from "preact/hooks";
import { folderDeleteConfirm } from "../state/ui";
import { currentUser } from "../state/auth";
import { folders as foldersSignal } from "../state/folders";
import { scenes as scenesSignal } from "../state/scenes";
import { deleteFolderRequest } from "../net/socket";

export function FolderDeleteModal() {
  const folderId = folderDeleteConfirm.value;
  const close = useCallback(() => {
    folderDeleteConfirm.value = null;
  }, []);

  useEffect(() => {
    if (!folderId) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [folderId, close]);

  if (!folderId) return null;
  if (currentUser.value?.role !== "GM") return null;

  const folder = foldersSignal.value.get(folderId);
  if (!folder) return null;

  const affectedScenes = [...scenesSignal.value.values()].filter((s) => s.system.folder === folderId);

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div class="flex max-h-[85vh] w-full max-w-md flex-col rounded-lg border border-white/10 bg-[#181a1f] shadow-2xl text-xs text-[#e7e9ee]">
        <header class="flex items-center justify-between border-b border-white/10 px-5 py-3.5 bg-[#14171c] rounded-t-lg">
          <div class="flex items-center gap-2">
            <span class="text-base">⚠️</span>
            <h2 class="text-sm font-semibold tracking-wide text-white">Delete folder</h2>
          </div>
          <button type="button" onClick={close} class="rounded p-1 text-muted hover:bg-white/10 hover:text-white" title="Cerrar (Esc)">✕</button>
        </header>
        <div class="flex-1 overflow-y-auto p-5 space-y-3">
          <p>
            ¿Borrar la carpeta <strong class="text-white">"{folder.name}"</strong>?
          </p>
          <ul class="space-y-1 text-[11px] text-muted">
            <li>· {affectedScenes.length} escena(s) quedarán sin carpeta.</li>
          </ul>
          <p class="text-[11px] text-amber-300/80">Esta acción no se puede deshacer.</p>
        </div>
        <footer class="flex items-center justify-end gap-2 border-t border-white/10 bg-[#14171c] px-5 py-3 rounded-b-lg">
          <button type="button" onClick={close} class="rounded border border-white/10 px-3 py-1 text-xs text-muted hover:text-white">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              deleteFolderRequest(folderId);
              close();
            }}
            class="rounded border border-red-500/40 bg-red-500/15 px-3 py-1 text-xs font-medium text-red-200 hover:bg-red-500/25"
          >
            Delete
          </button>
        </footer>
      </div>
    </div>
  );
}