import { useEffect, useState, useCallback } from "preact/hooks";
import { folderFormModal } from "../state/ui";
import { currentUser } from "../state/auth";
import { folders as foldersSignal } from "../state/folders";
import { updateFolderRequest } from "../net/socket";
import type { Folder } from "@rollforge/protocol";

export function FolderFormModal() {
  const ctx = folderFormModal.value;
  const close = useCallback(() => {
    folderFormModal.value = null;
  }, []);
  useEffect(() => {
    if (!ctx) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [ctx, close]);
  if (!ctx) return null;
  const folder = foldersSignal.value.get(ctx.folderId);
  if (!folder) return null;
  return <FolderForm close={close} folder={folder} />;
}

function FolderForm({ close, folder }: { close: () => void; folder: Folder }) {
  const isGM = currentUser.value?.role === "GM";
  const [name, setName] = useState(folder.name);

  const submit = (e: Event) => {
    e.preventDefault();
    updateFolderRequest(folder.id, name.trim() || folder.name);
    close();
  };

  if (!isGM) return null;

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div class="flex max-h-[85vh] w-full max-w-md flex-col rounded-lg border border-white/10 bg-[#181a1f] shadow-2xl text-xs text-[#e7e9ee]">
        <header class="flex items-center justify-between border-b border-white/10 px-5 py-3.5 bg-[#14171c] rounded-t-lg">
          <div class="flex items-center gap-2">
            <span class="text-base">📁</span>
            <h2 class="text-sm font-semibold tracking-wide text-white">Rename Folder</h2>
          </div>
          <button type="button" onClick={close} class="rounded p-1 text-muted hover:bg-white/10 hover:text-white" title="Cerrar (Esc)">✕</button>
        </header>
        <form onSubmit={submit} class="flex-1 overflow-y-auto p-5 space-y-2">
          <FormField label="Name" value={name} onChange={setName} />
        </form>
        <footer class="flex items-center justify-end gap-2 border-t border-white/10 bg-[#14171c] px-5 py-3 rounded-b-lg">
          <button type="button" onClick={close} class="rounded border border-white/10 px-3 py-1 text-xs text-muted hover:text-white">
            Cancel
          </button>
          <button type="button" onClick={submit} class="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:opacity-90">
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}

function FormField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label class="flex flex-col gap-1 text-[11px]">
      <span class="text-muted">{label}</span>
      <input
        type="text"
        value={value}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        class="rounded border border-white/10 bg-black/40 px-2.5 py-1 text-xs text-white outline-none focus:border-accent"
      />
    </label>
  );
}