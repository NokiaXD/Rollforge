import { useState, useEffect, useCallback } from "preact/hooks";
import { users as usersSignal, currentUser, type PublicUser } from "../state/auth";
import { scenes } from "../state/scenes";
import { listUsers, gmResetPassword, gmDeleteUser } from "../net/auth";
import { createSceneRequest, deleteSceneRequest, setActiveSceneAsGM, updateSceneRequest } from "../net/socket";
import { uploadImage } from "../net/uploads";
import type { Scene, SceneSystem } from "@rollforge/protocol";

interface GmPanelProps {
  onClose: () => void;
}

// Each entry is a section in the sidebar. Add new sections here and to renderSection().
interface Section {
  id: string;
  label: string;
}

const SECTIONS: Section[] = [
  { id: "scenes", label: "Scenes" },
  { id: "users", label: "Users" },
];

const MIN_PASSWORD_LEN = 8;

export function GmPanel({ onClose }: GmPanelProps) {
  const [activeId, setActiveId] = useState<string>(SECTIONS[0]!.id);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );
  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  return (
    <div class="fixed inset-0 z-30 flex bg-black/70">
      <aside class="flex w-64 shrink-0 flex-col border-r border-white/10 bg-[#14171c]">
        <header class="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 class="text-sm font-semibold tracking-wide">GM Panel</h2>
          <button
            type="button"
            onClick={onClose}
            class="rounded p-1 text-[var(--color-muted)] hover:bg-white/10 hover:text-white"
            title="Close (Esc)"
          >
            ✕
          </button>
        </header>
        <nav class="flex-1 overflow-y-auto p-2">
          {SECTIONS.map((s) => {
            const active = s.id === activeId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveId(s.id)}
                class={`mb-1 flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm transition-colors ${
                  active
                    ? "bg-amber-500/15 text-amber-200"
                    : "text-[var(--color-fg)] hover:bg-white/5"
                }`}
              >
                <span class={`h-1.5 w-1.5 rounded-full ${active ? "bg-amber-400" : "bg-white/20"}`} />
                {s.label}
              </button>
            );
          })}
        </nav>
        <footer class="border-t border-white/10 px-4 py-3 text-xs text-[var(--color-muted)]">
          Signed in as <span class="text-amber-300">{currentUser.value?.username}</span>
        </footer>
      </aside>

      <main class="flex-1 overflow-y-auto bg-[#1a1d23] p-8">
        {activeId === "scenes" && <ScenesSection />}
        {activeId === "users" && <UsersSection />}
      </main>
    </div>
  );
}

// --- Users section ---

function UsersSection() {
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    await listUsers();
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy || !selected || newPassword.length < MIN_PASSWORD_LEN) return;
    setBusy(true);
    setFeedback(null);
    const err = await gmResetPassword(selected, newPassword);
    setBusy(false);
    if (err) {
      setFeedback({ kind: "err", text: err.code === "not-found" ? "User not found." : `Error: ${err.status}` });
    } else {
      setFeedback({ kind: "ok", text: `Password for "${selected}" updated.` });
      setNewPassword("");
    }
  };

  const onDelete = async (username: string) => {
    if (busy) return;
    if (!window.confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    setBusy(true);
    setFeedback(null);
    const err = await gmDeleteUser(username);
    setBusy(false);
    if (err) {
      const map: Record<string, string> = {
        "cannot-delete-self": "You cannot delete yourself.",
        "cannot-delete-last-gm": "Cannot delete the last GM.",
        "not-found": "User not found.",
      };
      setFeedback({ kind: "err", text: map[err.code] ?? `Error: ${err.status}` });
      return;
    }
    setFeedback({ kind: "ok", text: `User "${username}" deleted.` });
    if (selected === username) setSelected("");
    await refresh();
  };

  return (
    <div class="mx-auto max-w-3xl">
      <h1 class="mb-1 text-lg font-semibold">Users</h1>
      <p class="mb-6 text-xs text-[var(--color-muted)]">
        Manage accounts and reset forgotten passwords.
      </p>

      <section class="mb-8 rounded-lg border border-white/10 bg-black/30 p-5">
        <h2 class="mb-3 text-sm font-medium">Account list</h2>
        {loading ? (
          <p class="text-xs text-[var(--color-muted)]">Loading…</p>
        ) : (
          <UserTable list={usersSignal.value} currentUsername={currentUser.value?.username ?? ""} onDelete={onDelete} busy={busy} />
        )}
      </section>

      <section class="rounded-lg border border-white/10 bg-black/30 p-5">
        <h2 class="mb-3 text-sm font-medium">Reset a user's password</h2>
        <form onSubmit={submit} class="flex flex-col gap-3">
          <select
            value={selected}
            onChange={(e) => setSelected((e.target as HTMLSelectElement).value)}
            disabled={busy}
            class="rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-[var(--color-accent)]"
          >
            <option value="">— pick a user —</option>
            {usersSignal.value.map((u) => (
              <option key={u.username} value={u.username}>
                {u.username} ({u.role})
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder={`New password (min ${MIN_PASSWORD_LEN} chars)`}
            value={newPassword}
            onInput={(e) => setNewPassword((e.target as HTMLInputElement).value)}
            disabled={busy}
            autocomplete="off"
            spellcheck={false}
            class="rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-[var(--color-accent)]"
          />
          <button
            type="submit"
            disabled={busy || !selected || newPassword.length < MIN_PASSWORD_LEN}
            class="self-start rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? "..." : "Reset password"}
          </button>
        </form>
        {feedback && (
          <p
            class={`mt-3 rounded border px-3 py-2 text-xs ${
              feedback.kind === "ok"
                ? "border-green-500/30 bg-green-500/10 text-green-300"
                : "border-red-500/30 bg-red-500/10 text-red-300"
            }`}
          >
            {feedback.text}
          </p>
        )}
      </section>
    </div>
  );
}

function UserTable({
  list,
  currentUsername,
  onDelete,
  busy,
}: {
  list: PublicUser[];
  currentUsername: string;
  onDelete: (username: string) => void;
  busy: boolean;
}) {
  if (list.length === 0) {
    return <p class="text-xs text-[var(--color-muted)]">No users yet.</p>;
  }
  return (
    <table class="w-full text-sm">
      <thead>
        <tr class="text-[var(--color-muted)]">
          <th class="py-2 text-left font-normal">Username</th>
          <th class="py-2 text-left font-normal">Role</th>
          <th class="py-2 text-right font-normal">Created</th>
          <th class="py-2 text-right font-normal"></th>
        </tr>
      </thead>
      <tbody>
        {list.map((u) => {
          const isSelf = u.username === currentUsername;
          return (
            <tr key={u.username} class="border-t border-white/5">
              <td class="py-2">
                {u.username}
                {isSelf && <span class="ml-2 text-[10px] text-[var(--color-muted)]">(you)</span>}
              </td>
              <td class="py-2">
                <span
                  class={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                    u.role === "GM"
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-blue-500/20 text-blue-300"
                  }`}
                >
                  {u.role}
                </span>
              </td>
              <td class="py-2 text-right text-[var(--color-muted)]">
                {new Date(u.createdAt).toISOString().slice(0, 10)}
              </td>
              <td class="py-2 text-right">
                <button
                  type="button"
                  onClick={() => onDelete(u.username)}
                  disabled={busy || isSelf}
                  title={isSelf ? "Cannot delete yourself" : "Delete user"}
                  class="rounded border border-red-500/30 px-2 py-0.5 text-xs text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Delete
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// --- Scenes section ---

function ScenesSection() {
  const list = [...scenes.value.values()].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  return (
    <div class="mx-auto max-w-3xl">
      <h1 class="mb-1 text-lg font-semibold">Scenes</h1>
      <p class="mb-6 text-xs text-[var(--color-muted)]">
        Create and edit the scenes players can be brought to.
      </p>

      <section class="mb-8 rounded-lg border border-white/10 bg-black/30 p-5">
        <h2 class="mb-3 text-sm font-medium">Scene registry</h2>
        {list.length === 0 ? (
          <p class="text-xs text-[var(--color-muted)]">No scenes yet.</p>
        ) : (
          <ul class="flex flex-col gap-2">
            {list.map((s) => (
              <li key={s.id}>
                <SceneRow scene={s} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section class="rounded-lg border border-white/10 bg-black/30 p-5">
        <h2 class="mb-3 text-sm font-medium">Create a new scene</h2>
        <NewSceneForm />
      </section>
    </div>
  );
}

function SceneRow({ scene }: { scene: Scene }) {
  const [editing, setEditing] = useState(false);
  const handleActivate = () => setActiveSceneAsGM(scene.id);
  const handleDelete = () => {
    if (!window.confirm(`Delete scene "${scene.name}"? Tokens in it will become orphaned.`)) return;
    deleteSceneRequest(scene.id);
  };

  return (
    <div class="rounded border border-white/5 bg-black/20 px-3 py-2">
      <div class="flex items-center justify-between">
        <div class="flex flex-col gap-0.5">
          <span class="text-sm font-medium text-white">{scene.name}</span>
          <span class="text-[10px] text-[var(--color-muted)]">
            id: <code class="font-mono">{scene.id}</code> · {Math.round(scene.system.width / scene.system.grid.size)}×{Math.round(scene.system.height / scene.system.grid.size)} tiles · grid {scene.system.grid.size}px
          </span>
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            onClick={handleActivate}
            class="rounded border border-white/10 px-2 py-0.5 text-xs text-[var(--color-muted)] hover:text-white"
          >
            Set active
          </button>
          <button
            type="button"
            onClick={() => setEditing(!editing)}
            class="rounded border border-white/10 px-2 py-0.5 text-xs text-[var(--color-muted)] hover:text-white"
          >
            {editing ? "Cancel" : "Edit"}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            class="rounded border border-red-500/30 px-2 py-0.5 text-xs text-red-300 hover:bg-red-500/10"
          >
            Delete
          </button>
        </div>
      </div>
      {editing && <SceneEditForm scene={scene} onDone={() => setEditing(false)} />}
    </div>
  );
}

function SceneEditForm({ scene, onDone }: { scene: Scene; onDone: () => void }) {
  const [name, setName] = useState(scene.name);
  const [width, setWidth] = useState(String(Math.round(scene.system.width / scene.system.grid.size)));
  const [height, setHeight] = useState(String(Math.round(scene.system.height / scene.system.grid.size)));
  const [background, setBackground] = useState(scene.system.background ?? "");
  const [gridSize, setGridSize] = useState(String(scene.system.grid.size));
  const [gridColor, setGridColor] = useState("#" + scene.system.grid.color.toString(16).padStart(6, "0"));
  const [gridType, setGridType] = useState<"square" | "hex">(scene.system.grid.type);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  const submit = (e: Event) => {
    e.preventDefault();
    const w = Number(width);
    const h = Number(height);
    const gs = Number(gridSize);
    const gc = parseInt(gridColor.replace(/^#/, ""), 16);
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0 || !Number.isFinite(gs) || gs <= 0 || !Number.isFinite(gc)) {
      setFeedback({ kind: "err", text: "Invalid numeric fields." });
      return;
    }
    const system: SceneSystem = {
      width: w * gs,
      height: h * gs,
      background: background.trim() || null,
      grid: { size: gs, color: gc, type: gridType },
    };
    updateSceneRequest(scene.id, name, system);
    setFeedback({ kind: "ok", text: "Scene updated." });
    onDone();
  };

  const onUpload = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setUploading(true);
    setFeedback(null);
    try {
      const { url } = await uploadImage(file);
      setBackground(url);
      setFeedback({ kind: "ok", text: `Uploaded ${file.name}. Click Save to apply.` });
    } catch (err) {
      setFeedback({ kind: "err", text: `Upload failed: ${(err as Error).message}` });
    } finally {
      setUploading(false);
      input.value = "";
    }
  };

  const isImageUrl = background.startsWith("/uploads/") || background.startsWith("http");

  return (
    <form onSubmit={submit} class="mt-3 grid grid-cols-2 gap-3 border-t border-white/5 pt-3">
      <Field label="Name" value={name} onChange={setName} />
      <div />
      <Field label="Width (tiles)" value={width} onChange={setWidth} />
      <Field label="Height (tiles)" value={height} onChange={setHeight} />
      <Field label="Background (URL or #hex color)" value={background} onChange={setBackground} />
      <Field label="Grid size (px)" value={gridSize} onChange={setGridSize} />
      <Field label="Grid color (#rrggbb)" value={gridColor} onChange={setGridColor} />
      <label class="flex flex-col gap-1 text-xs">
        <span class="text-[var(--color-muted)]">Grid type</span>
        <select
          value={gridType}
          onChange={(e) => setGridType((e.target as HTMLSelectElement).value as "square" | "hex")}
          class="rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-[var(--color-accent)]"
        >
          <option value="square">Square</option>
          <option value="hex">Hex</option>
        </select>
      </label>
      <div class="col-span-2 flex flex-col gap-2 rounded border border-white/5 bg-black/20 p-3">
        <span class="text-xs text-[var(--color-muted)]">Map upload (PNG/JPG/GIF/WEBP, ≤10MB)</span>
        <div class="flex items-center gap-3">
          <label class="cursor-pointer rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs text-white hover:bg-blue-500">
            {uploading ? "Uploading…" : "Choose file"}
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden" onChange={onUpload} disabled={uploading} />
          </label>
          {isImageUrl && (
            <img
              src={background}
              alt="map preview"
              class="h-12 w-12 rounded border border-white/10 object-cover"
            />
          )}
        </div>
      </div>
      <div class="col-span-2 flex items-center gap-3">
        <button
          type="submit"
          class="self-start rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Save
        </button>
        {feedback && (
          <span
            class={`text-xs ${
              feedback.kind === "ok" ? "text-green-300" : "text-red-300"
            }`}
          >
            {feedback.text}
          </span>
        )}
      </div>
    </form>
  );
}

function NewSceneForm() {
  const [name, setName] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [width, setWidth] = useState("500");
  const [height, setHeight] = useState("500");
  const [gridSize, setGridSize] = useState("50");
  const [gridColor, setGridColor] = useState("#2c313a");
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const submit = (e: Event) => {
    e.preventDefault();
    const id = sceneId.trim();
    if (!id) {
      setFeedback({ kind: "err", text: "Scene id is required." });
      return;
    }
    if (scenes.value.has(id)) {
      setFeedback({ kind: "err", text: `Scene "${id}" already exists.` });
      return;
    }
    const w = Number(width);
    const h = Number(height);
    const gs = Number(gridSize);
    const gc = parseInt(gridColor.replace(/^#/, ""), 16);
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0 || !Number.isFinite(gs) || gs <= 0 || !Number.isFinite(gc)) {
      setFeedback({ kind: "err", text: "Invalid numeric fields." });
      return;
    }
    const system: SceneSystem = {
      width: w * gs,
      height: h * gs,
      background: null,
      grid: { size: gs, color: gc, type: "square" },
    };
    const finalName = name.trim() || id;
    createSceneRequest(id, finalName, system);
    setName("");
    setSceneId("");
    setFeedback({ kind: "ok", text: `Scene "${finalName}" created.` });
  };

  return (
    <form onSubmit={submit} class="grid grid-cols-2 gap-3">
      <Field label="Name" value={name} onChange={setName} />
      <Field label="Scene id (technical key)" value={sceneId} onChange={setSceneId} />
      <Field label="Width" value={width} onChange={setWidth} />
      <Field label="Height" value={height} onChange={setHeight} />
      <Field label="Grid size (px)" value={gridSize} onChange={setGridSize} />
      <Field label="Grid color (#rrggbb)" value={gridColor} onChange={setGridColor} />
      <div class="col-span-2 flex items-center gap-3">
        <button
          type="submit"
          class="self-start rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Create scene
        </button>
        {feedback && (
          <span
            class={`text-xs ${
              feedback.kind === "ok" ? "text-green-300" : "text-red-300"
            }`}
          >
            {feedback.text}
          </span>
        )}
      </div>
    </form>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label class="flex flex-col gap-1 text-xs">
      <span class="text-[var(--color-muted)]">{label}</span>
      <input
        type="text"
        value={value}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        class="rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-[var(--color-accent)]"
      />
    </label>
  );
}