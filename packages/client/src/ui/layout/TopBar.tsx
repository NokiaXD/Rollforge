import { activeSceneId, currentSceneId, gmCameraSceneId } from "../../state/scene";
import { scenes } from "../../state/scenes";
import { currentUser, authStatus } from "../../state/auth";
import { gmUsersModalOpen } from "../../state/ui";
import { createTokenRequest, setActiveSceneAsGM, setGmCamera } from "../../net/socket";
import { logout } from "../../net/auth";

import { chatOpen, toggleChat, messages } from "../../state/chat";
import { toggleRightSidebar } from "../../state/layout";

export function TopBar() {
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
    <header class="pointer-events-auto flex h-9 shrink-0 select-none items-center justify-between border-b border-white/10 bg-[#181a1f]/90 backdrop-blur-md px-3 text-xs text-[#e7e9ee] shadow-md z-20">
      {/* Left: Brand & current scene */}
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-1.5 font-bold tracking-wider text-white">
          <span class="">
            Rollforge
          </span>
        </div>
        <div class="h-3.5 w-px bg-white/10" />
        <span class="text-muted text-[11px]">
          Escena: <strong class="text-white font-medium">{activeScene?.name ?? activeSceneId.value}</strong>
        </span>
      </div>

      {/* Center: GM Camera Controls & Sync */}
      <div class="flex items-center gap-2">
        {isGM && (
          <>
            <label class="flex items-center gap-1.5 text-[11px] text-muted">
              <span>Cámara GM:</span>
              <select
                value={gmCameraSceneId.value}
                onChange={onCameraSelect}
                class="rounded border border-white/10 bg-black/40 px-2 py-0.5 text-xs text-white outline-none focus:border-[var(--color-accent)]"
              >
                {sceneOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.id}
                  </option>
                ))}
              </select>
            </label>
            {diverge && (
              <button
                type="button"
                onClick={onBringPlayers}
                title={`Mover jugadores a "${cameraScene?.name ?? gmCameraSceneId.value}"`}
                class="rounded border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-200 hover:bg-amber-500/25 transition-colors animate-pulse"
              >
                Traer jugadores aquí ➔
              </button>
            )}
          </>
        )}
      </div>

      {/* Right: Actions & Secondary Sidebar toggle */}
      <div class="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => toggleRightSidebar()}
          title="Alternar Barra Lateral Derecha (Ctrl+Alt+B)"
          class="text-muted transition-colors *:hover:text-white"
        >
          {/* VS Code secondary sidebar icon (right panel) */}
         
          <div class="rotate-90"><i class="nf nf-fa-window_maximize text-3xl"></i></div>
          
        </button>
      </div>
    </header>
  );
}
