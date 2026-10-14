import { useEffect, useState, useCallback } from "preact/hooks";
import { sceneFormModal } from "../state/ui";
import { currentUser } from "../state/auth";
import { scenes } from "../state/scenes";
import { folders as foldersSignal } from "../state/folders";
import { lastError } from "../state/scene";
import { createSceneRequest, updateSceneRequest } from "../net/socket";
import { uploadImage } from "../net/uploads";
import type { Scene, SceneSystem } from "@rollforge/protocol";

export function SceneFormModal() {
  const ctx = sceneFormModal.value;
  const close = useCallback(() => {
    sceneFormModal.value = null;
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
  if (ctx.mode === "edit") {
    const scene = scenes.value.get(ctx.sceneId);
    if (!scene) return null;
    return <SceneForm close={close} mode="edit" scene={scene} />;
  }
  return <SceneForm close={close} mode="create" initialFolderId={ctx.folderId ?? null} />;
}

function SceneForm({
  close,
  mode,
  scene,
  initialFolderId,
}: {
  close: () => void;
  mode: "create" | "edit";
  scene?: Scene;
  initialFolderId?: string | null;
}) {
  const isGM = currentUser.value?.role === "GM";
  const allFolders = [...foldersSignal.value.values()];
  const [name, setName] = useState(scene?.name ?? "");
  const [sceneId, setSceneId] = useState(scene?.id ?? "");
  const [width, setWidth] = useState(String(Math.round((scene?.system.width ?? 2000) / (scene?.system.grid.size ?? 50))));
  const [height, setHeight] = useState(String(Math.round((scene?.system.height ?? 2000) / (scene?.system.grid.size ?? 50))));
  const [background, setBackground] = useState(scene?.system.background ?? "");
  const [gridSize, setGridSize] = useState(String(scene?.system.grid.size ?? 50));
  const [gridColor, setGridColor] = useState(scene ? "#" + scene.system.grid.color.toString(16).padStart(6, "0") : "#2c313a");
  const [gridType, setGridType] = useState<"square" | "hex">(scene?.system.grid.type ?? "square");
  //  Ruler scale (Paso 24). Optional in SceneSystem, so the fallback is here.
  const [cellLength, setCellLength] = useState(String(scene?.system.cellLength ?? 5));
  const [units, setUnits] = useState<"ft" | "m">(scene?.system.units ?? "ft");
  const [folderId, setFolderId] = useState<string | null>(
    scene ? (scene.system.folder ?? null) : (initialFolderId ?? null),
  );
  const [img, setImg] = useState<string | null>(scene?.img ?? null);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (e: Event): Promise<string | null> => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return null;
    setUploading(true);
    setFeedback(null);
    try {
      const { url } = await uploadImage(file);
      setFeedback({ kind: "ok", text: `Uploaded ${file.name}. Save to apply.` });
      return url;
    } catch (err) {
      setFeedback({ kind: "err", text: `Upload failed: ${(err as Error).message}` });
      return null;
    } finally {
      setUploading(false);
      input.value = "";
    }
  };

  const submit = (e: Event) => {
    e.preventDefault();
    const w = Number(width);
    const h = Number(height);
    const gs = Number(gridSize);
    const gc = parseInt(gridColor.replace(/^#/, ""), 16);
    const cl = Number(cellLength);
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0 || !Number.isFinite(gs) || gs <= 0 || !Number.isFinite(gc) || !Number.isFinite(cl) || cl <= 0) {
      setFeedback({ kind: "err", text: "Invalid numeric fields." });
      return;
    }
    if (mode === "create") {
      const id = sceneId.trim();
      if (!id) {
        setFeedback({ kind: "err", text: "Scene id is required." });
        return;
      }
      if (scenes.value.has(id)) {
        setFeedback({ kind: "err", text: `Scene "${id}" already exists.` });
        return;
      }
      const system: SceneSystem = {
        width: w * gs,
        height: h * gs,
        background: background.trim() || null,
        folder: folderId,
        grid: { size: gs, color: gc, type: gridType },
        cellLength: cl,
        units,
      };
      const finalName = name.trim() || id;
      createSceneRequest(id, finalName, system, img, folderId);
      setFeedback({ kind: "ok", text: `Scene "${finalName}" created.` });
      close();
      return;
    }
    if (!scene) return;
    const system: SceneSystem = {
      width: w * gs,
      height: h * gs,
      background: background.trim() || null,
      folder: folderId,
      grid: { size: gs, color: gc, type: gridType },
      cellLength: cl,
      units,
    };
    updateSceneRequest(scene.id, name, system, img, folderId);
    setFeedback({ kind: "ok", text: "Scene updated." });
    close();
  };

  if (!isGM) return null;

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div class="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-white/10 bg-[#181a1f] shadow-2xl text-xs text-[#e7e9ee]">
        <header class="flex items-center justify-between border-b border-white/10 px-5 py-3.5 bg-[#14171c] rounded-t-lg">
          <div class="flex items-center gap-2">
            <span class="text-base">🗺️</span>
            <h2 class="text-sm font-semibold tracking-wide text-white">
              {mode === "create" ? "Create Scene" : "Edit Scene"}
            </h2>
          </div>
          <button type="button" onClick={close} class="rounded p-1 text-muted hover:bg-white/10 hover:text-white" title="Cerrar (Esc)">✕</button>
        </header>
        <form onSubmit={submit} class="flex-1 overflow-y-auto p-5 space-y-2">
          {mode === "create" && (
            <FormField label="Scene id (technical key)" value={sceneId} onChange={setSceneId} />
          )}
          <FormField label="Name" value={name} onChange={setName} />
          <FolderSelect value={folderId} onChange={setFolderId} folders={allFolders} />
          <div class="grid grid-cols-2 gap-2">
            <FormField label="Width (tiles)" value={width} onChange={setWidth} />
            <FormField label="Height (tiles)" value={height} onChange={setHeight} />
          </div>
          <div class="grid grid-cols-2 gap-2">
            <FormField label="Grid size (px)" value={gridSize} onChange={setGridSize} />
            <FormField label="Grid color (#rrggbb)" value={gridColor} onChange={setGridColor} />
          </div>
          <label class="flex flex-col gap-1 text-[11px]">
            <span class="text-muted">Grid type</span>
            <select
              value={gridType}
              onChange={(e) => setGridType((e.target as HTMLSelectElement).value as "square" | "hex")}
              class="custom-select rounded border border-white/10 bg-black/40 px-2.5 py-1 text-xs text-white outline-none focus:border-accent"
            >
              <option value="square">Square</option>
              <option value="hex">Hex</option>
            </select>
          </label>
          <div class="grid grid-cols-2 gap-2">
            <FormField label="Distance per cell" value={cellLength} onChange={setCellLength} />
            <label class="flex flex-col gap-1 text-[11px]">
              <span class="text-muted">Units</span>
              <select
                value={units}
                onChange={(e) => setUnits((e.target as HTMLSelectElement).value as "ft" | "m")}
                class="custom-select rounded border border-white/10 bg-black/40 px-2.5 py-1 text-xs text-white outline-none focus:border-accent"
              >
                <option value="ft">Feet (ft)</option>
                <option value="m">Metres (m)</option>
              </select>
            </label>
          </div>
          <p class="text-[10px] text-muted">
            Ruler: 1 cell = {cellLength} {units === "m" ? "m" : "ft"}
          </p>
          <FormField label="Background (URL or color)" value={background} onChange={setBackground} />

          <ImageUploadField
            label="Background image (≤10MB)"
            value={isHttpUrl(background) ? background : null}
            previewClass="h-12 w-20"
            uploading={uploading}
            onUpload={async (e) => {
              const url = await upload(e);
              if (url) setBackground(url);
            }}
            onClear={() => setBackground("")}
          />

          <ImageUploadField
            label="Thumbnail (≤10MB)"
            value={img}
            previewClass="h-8 w-8"
            uploading={uploading}
            onUpload={async (e) => {
              const url = await upload(e);
              if (url) setImg(url);
            }}
            onClear={() => setImg(null)}
          />

          {feedback && (
            <p class={`text-[11px] ${feedback.kind === "ok" ? "text-green-300" : "text-red-300"}`}>
              {feedback.text}
            </p>
          )}
        </form>
        <footer class="flex items-center justify-end gap-2 border-t border-white/10 bg-[#14171c] px-5 py-3 rounded-b-lg">
          <button type="button" onClick={close} class="rounded border border-white/10 px-3 py-1 text-xs text-muted hover:text-white">
            Cancel
          </button>
          <button type="button" onClick={submit} class="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:opacity-90">
            {mode === "create" ? "Create scene" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function isHttpUrl(v: string): boolean {
  return /^https?:\/\//i.test(v.trim());
}

function ImageUploadField({
  label,
  value,
  previewClass,
  uploading,
  onUpload,
  onClear,
}: {
  label: string;
  value: string | null;
  previewClass: string;
  uploading: boolean;
  onUpload: (e: Event) => void;
  onClear: () => void;
}) {
  return (
    <div class="rounded border border-white/5 bg-black/30 p-2">
      <span class="text-[10px] text-muted block mb-1.5">{label}</span>
      <div class="flex items-center gap-2">
        <label class="cursor-pointer rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90 transition-opacity">
          {uploading ? "Uploading…" : value ? "Replace" : "Choose file"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            class="hidden"
            onChange={onUpload}
            disabled={uploading}
          />
        </label>
        {value && (
          <>
            <img src={value} alt="" class={`${previewClass} rounded border border-white/10 object-cover`} />
            <button type="button" onClick={onClear} class="rounded border border-white/10 px-2 py-0.5 text-[11px] text-muted hover:text-white">
              Remove
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function FolderSelect({
  value,
  onChange,
  folders,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  folders: import("@rollforge/protocol").Folder[];
}) {
  return (
    <label class="flex flex-col gap-1 text-[11px]">
      <span class="text-muted">Folder</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(((e.target as HTMLSelectElement).value) || null)}
        class="custom-select rounded border border-white/10 bg-black/40 px-2.5 py-1 text-xs text-white outline-none focus:border-accent"
      >
        <option value="">— Sin carpeta —</option>
        {folders
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
      </select>
    </label>
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