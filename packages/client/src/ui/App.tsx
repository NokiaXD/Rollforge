import { useEffect } from "preact/hooks";
import { effect } from "@preact/signals";
import { Graphics } from "pixi.js";
import { authStatus } from "../state/auth";
import { LoginForm } from "./LoginForm";
import { Toolbar } from "./Toolbar";
import { ChatPanel } from "./ChatPanel";
import { createPixi } from "../canvas/pixiApp";
import { drawGrid } from "../canvas/grid";
import { drawBackground, type BackgroundHandle } from "../canvas/background";
import { SceneRenderer } from "../canvas/sceneRenderer";
import { connectSocket, disconnectSocket, sendIntent } from "../net/socket";
import { viewedScene } from "../state/scenes";

export function App() {
  const status = authStatus.value;

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
    <>
      <div id="canvas-host" />
      <Toolbar />
      <ChatPanel />
    </>
  );
}
