import { useEffect } from "preact/hooks";
import { effect } from "@preact/signals";
import { Graphics } from "pixi.js";
import { authStatus, currentUser } from "../state/auth";
import { lastError, currentSceneId } from "../state/scene";
import {
  activeSidebarTab,
  toggleSidebar,
  gmUsersModalOpen,
  settingsModalOpen,
  openContextMenu,
} from "../state/ui";
import { LoginForm } from "./LoginForm";
import { TopBar } from "./layout/TopBar";
import { ActivityBar } from "./layout/ActivityBar";
import { Sidebar } from "./layout/Sidebar";
import { RightSidebar } from "./layout/RightSidebar";
import { StatusBar } from "./layout/StatusBar";
import { toggleChat } from "../state/chat";
import { GmUsersModal } from "./GmUsersModal";
import { SettingsModal } from "./SettingsModal";
import { SceneFormModal } from "./SceneFormModal";
import { FolderFormModal } from "./FolderFormModal";
import { FolderDeleteModal } from "./FolderDeleteModal";
import { ContextMenu } from "./ContextMenu";
import { createPixi } from "../canvas/pixiApp";
import { drawGrid } from "../canvas/grid";
import { drawBackground, type BackgroundHandle } from "../canvas/background";
import { SceneRenderer } from "../canvas/sceneRenderer";
import {
  connectSocket,
  createTokenRequest,
  disconnectSocket,
  sendIntent,
} from "../net/socket";
import { viewedScene } from "../state/scenes";

export function App() {
  const status = authStatus.value;

  // Global keyboard shortcuts (e.g. Ctrl+B for primary sidebar, Ctrl+Alt+B for chat sidebar)
  useEffect(() => {
    if (status !== "authenticated") return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        if (e.altKey || e.shiftKey) {
          toggleChat();
        } else {
          toggleSidebar(activeSidebarTab.value ?? "scenes");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let isCancelled = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      const host = document.getElementById("canvas-host");
      if (!host) return;
      const ctx = await createPixi(host);
      if (isCancelled) {
        ctx.destroy();
        return;
      }
      let grid: Graphics | null = null;
      let bgToken = 0;
      let background: BackgroundHandle | null = null;
      const disposers: Array<() => void> = [];

      // Reactive grid + viewport size. Re-draws whenever the rendered scene's grid/world changes.
      const offGrid = effect(() => {
        const scene = viewedScene.value;
        const size = scene?.system.grid.size ?? 50;
        const width = scene?.system.width ?? 4000;
        const height = scene?.system.height ?? 4000;
        const color = scene?.system.grid.color ?? 0x2c313a;
        ctx.viewport.resize(ctx.viewport.screenWidth, ctx.viewport.screenHeight, width, height);
        if (grid) {
          ctx.viewport.removeChild(grid);
          grid.destroy();
        }
        grid = drawGrid(ctx.viewport, width, height, size, color);
      });
      disposers.push(offGrid);

      // Reactive background. Token-cancellable so a slow image load can't override a newer scene.
      const offBg = effect(() => {
        const scene = viewedScene.value;
        const bg = scene?.system.background ?? null;
        const w = scene?.system.width ?? 4000;
        const h = scene?.system.height ?? 4000;
        if (background) {
          background.destroy();
          background = null;
        }
        if (!bg) return;
        const myToken = ++bgToken;
        void drawBackground(ctx.viewport, bg, w, h).then((handle) => {
          if (myToken !== bgToken) {
            handle?.destroy();
            return;
          }
          background = handle;
        });
      });
      disposers.push(offBg);

      const renderer = new SceneRenderer(ctx.viewport, sendIntent);
      disposers.push(() => renderer.destroy());
      connectSocket();

      //  native contextmenu fires after a non-drag right-click; the browser
      // suppresses it when the user actually panned with right-mouse. We open a tiny
      // GM menu to spawn a token at the cursor world position.
      const isGM = currentUser.value?.role === "GM";
      if (isGM) {
        const onContextMenu = (e: MouseEvent) => {
          const rect = ctx.app.canvas.getBoundingClientRect();
          if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
          const world = ctx.viewport.toWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          openContextMenu(e, [
            {
              label: "Crear token aquí",
              hint: `${Math.round(world.x)}, ${Math.round(world.y)}`,
              onClick: () => createTokenRequest(currentSceneId.value, world.x, world.y),
            },
          ]);
        };
        ctx.app.canvas.addEventListener("contextmenu", onContextMenu);
        disposers.push(() => ctx.app.canvas.removeEventListener("contextmenu", onContextMenu));
      }

      cleanup = () => {
        for (const d of disposers) d();
        if (grid) grid.destroy();
        if (background) background.destroy();
        ctx.destroy();
        disconnectSocket();
      };
      if (isCancelled) {
        cleanup();
      }
      if (import.meta.hot) {
        import.meta.hot.dispose(() => {
          cleanup?.();
        });
      }
    })();
    return () => {
      isCancelled = true;
      cleanup?.();
    };
  }, [status === "authenticated"]);

  if (status === "loading") return null;
  if (status === "anon") return <LoginForm />;

  return (
    <div class="relative h-screen w-screen overflow-hidden bg-[#0a0c0e] text-[#e7e9ee] select-none">
      {/* 1. Canvas Layer (Plano base / fondo completo) */}
      <div id="canvas-host" class="absolute inset-0 z-0" />

      {/* 2. UI Overlay Layer (Plano superior por encima del canvas) */}
      <div class="relative z-10 flex h-full w-full flex-col pointer-events-none">
        <TopBar />

        <div class="flex flex-1 min-h-0 relative">
          <ActivityBar />
          <Sidebar />

          {/* Área central transparente passthrough para interactuar directamente con el canvas */}
          <div class="flex-1 h-full pointer-events-none relative">
            {lastError.value && (
              <div
                role="alert"
                class="pointer-events-auto fixed left-1/2 top-12 z-40 -translate-x-1/2 rounded border border-red-500/40 bg-red-500/20 px-3 py-1.5 text-xs text-red-200 shadow-lg backdrop-blur-md"
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
          </div>

          <RightSidebar />
        </div>

        <StatusBar />
      </div>

      {/* Modales, diálogos y menú contextual */}
      {gmUsersModalOpen.value && <GmUsersModal />}
      {settingsModalOpen.value && <SettingsModal />}
      <SceneFormModal />
      <FolderFormModal />
      <FolderDeleteModal />
      <ContextMenu />
    </div>
  );
}
