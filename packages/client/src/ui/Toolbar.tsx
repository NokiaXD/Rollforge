import { useState } from "preact/hooks";
import { activeSceneId, currentSceneId, gmCameraSceneId, lastError, locks, tokens } from "../state/scene";
import { scenes } from "../state/scenes";
import { currentUser, authStatus } from "../state/auth";
import { createTokenRequest, setActiveSceneAsGM, setGmCamera } from "../net/socket";
import { logout } from "../net/auth";
import { GmPanel } from "./GmPanel";

export function Toolbar() {
  const [panelOpen, setPanelOpen] = useState(false);
  const user = currentUser.value;
  const isGM = user?.role === "GM";

  const onCreateToken = () => {
    createTokenRequest(currentSceneId.value, 200, 200);
  };

  const onCameraSelect = (e: Event) => {
    const value = (e.target as HTMLSelectElement).value;
    if (value) setGmCamera(value);
  };

  const onBringPlayers = () => {
    setActiveSceneAsGM(gmCameraSceneId.value);
  };

  const sceneOptions = [...scenes.value.values()].sort((a, b) => {
    const an = (a.name || a.id).toLowerCase();
    const bn = (b.name || b.id).toLowerCase();
    return an.localeCompare(bn);
  });

  const cameraScene = scenes.value.get(gmCameraSceneId.value);
  const activeScene = scenes.value.get(activeSceneId.value);
  const diverge = isGM && gmCameraSceneId.value !== activeSceneId.value;

  return (
    <>
      <div class="fixed inset-x-2 top-2 z-10 flex items-center gap-3 rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-xs backdrop-blur">
        {isGM ? (
          <>
            <label class="flex items-center gap-2">
              <span class="text-[var(--color-muted)]">Tu vista</span>
              <select
                value={gmCameraSceneId.value}
                onChange={onCameraSelect}
                class="rounded border border-white/10 bg-black/30 px-2 py-1 text-xs"
              >
                {sceneOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.id}
                  </option>
                ))}
              </select>
            </label>
            <span class="text-[var(--color-muted)]">
              Jugadores: <span class="text-white">{activeScene?.name ?? activeSceneId.value}</span>
            </span>
            {diverge && (
              <button
                type="button"
                onClick={onBringPlayers}
                title={`Mover jugadores a "${cameraScene?.name ?? gmCameraSceneId.value}"`}
                class="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200 hover:bg-amber-500/20"
              >
                Traer jugadores aquí
              </button>
            )}
          </>
        ) : (
          <span class="text-[var(--color-muted)]">
            Escena: <span class="text-white">{scenes.value.get(activeSceneId.value)?.name ?? activeSceneId.value}</span>
          </span>
        )}
        <button
          onClick={onCreateToken}
          class="rounded bg-[var(--color-accent)] px-3 py-1 text-xs text-white hover:bg-blue-500"
        >
          + Token
        </button>
        <span class="text-[var(--color-muted)]">Tokens: {tokens.value.size}</span>
        <span class="text-[var(--color-muted)]">Bloqueos: {locks.value.size}</span>
        <div class="ml-auto flex items-center gap-2">
          {user && (
            <>
              <span
                class={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                  user.role === "GM"
                    ? "bg-amber-500/20 text-amber-300"
                    : "bg-blue-500/20 text-blue-300"
                }`}
              >
                {user.role}
              </span>
              <span class="text-xs">{user.username}</span>
              {user.role === "GM" && (
                <button
                  onClick={() => setPanelOpen(true)}
                  class="rounded border border-amber-500/40 px-2 py-1 text-xs text-amber-300 hover:bg-amber-500/10"
                >
                  Panel
                </button>
              )}
              <button
                onClick={() => {
                  void logout();
                }}
                class="rounded border border-white/10 px-2 py-1 text-xs text-[var(--color-muted)] hover:text-white"
              >
                Logout
              </button>
            </>
          )}
          {authStatus.value === "authenticated" && !user && (
            <span class="text-xs text-[var(--color-muted)]">…</span>
          )}
        </div>
      </div>
      {lastError.value && (
        <div
          role="alert"
          class="fixed left-1/2 top-14 z-20 -translate-x-1/2 rounded border border-red-500/40 bg-red-500/15 px-3 py-1.5 text-xs text-red-200 shadow"
        >
          {lastError.value}{" "}
          <button
            type="button"
            onClick={() => (lastError.value = null)}
            class="ml-2 text-red-300/70 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}
      {panelOpen && <GmPanel onClose={() => setPanelOpen(false)} />}
    </>
  );
}
