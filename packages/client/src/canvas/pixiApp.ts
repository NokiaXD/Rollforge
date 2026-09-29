import { Application } from "pixi.js";
import { Viewport } from "pixi-viewport";

export interface PixiCtx {
  app: Application;
  viewport: Viewport;
  width: number;
  height: number;
  destroy: () => void;
}

export async function createPixi(host: HTMLElement): Promise<PixiCtx> {
  const width = host.clientWidth || window.innerWidth;
  const height = host.clientHeight || window.innerHeight;

  const app = new Application();
  await app.init({
    width,
    height,
    background: 0x1c1f24,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });
  host.appendChild(app.canvas);

  const viewport = new Viewport({
    screenWidth: width,
    screenHeight: height,
    worldWidth: 4000,
    worldHeight: 4000,
    events: app.renderer.events,
  });
  app.stage.addChild(viewport);

  // wheel = zoom centered on cursor; right-mouse / middle = pan. Default Pixi-viewport presets.
  viewport.drag({ mouseButtons: "right-middle" }).wheel({ smooth: 6 }).clampZoom({ minScale: 0.1, maxScale: 3 });

  const onResize = () => {
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    app.renderer.resize(w, h);
    viewport.resize(w, h, 4000, 4000);
  };
  window.addEventListener("resize", onResize);

  const destroy = () => {
    window.removeEventListener("resize", onResize);
    app.destroy(true, { children: true });
  };

  return { app, viewport, width, height, destroy };
}
