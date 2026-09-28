import { Assets, Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { Viewport } from "pixi-viewport";

export interface BackgroundHandle {
  destroy: () => void;
}

export function drawColorBackground(
  viewport: Viewport,
  color: number,
  worldWidth: number,
  worldHeight: number,
): BackgroundHandle {
  const container = new Container();
  const graphics = new Graphics();
  graphics.rect(0, 0, worldWidth, worldHeight).fill(color);
  container.addChild(graphics);
  viewport.addChildAt(container, 0);
  return {
    destroy: () => {
      viewport.removeChild(container);
      container.destroy({ children: true });
    },
  };
}

export async function drawImageBackground(viewport: Viewport, url: string): Promise<BackgroundHandle | null> {
  try {
    const texture = await Assets.load<Texture>(url);
    const sprite = new Sprite(texture);
    sprite.x = 0;
    sprite.y = 0;
    viewport.addChildAt(sprite, 0);
    return {
      destroy: () => {
        if (!sprite.destroyed) {
          viewport.removeChild(sprite);
          sprite.destroy();
        }
      },
    };
  } catch {
    return null;
  }
}

// background lives at world (0,0) at native size — grid shares origin so they coincide
// automatically when the GM picks the right grid.size. See plan Paso 10 image-upload section.
export async function drawBackground(
  viewport: Viewport,
  background: string | null,
  worldWidth: number,
  worldHeight: number,
): Promise<BackgroundHandle | null> {
  if (!background) return null;
  if (background.startsWith("#")) {
    const color = parseInt(background.slice(1), 16);
    if (!Number.isFinite(color)) return null;
    return drawColorBackground(viewport, color, worldWidth, worldHeight);
  }
  return drawImageBackground(viewport, background);
}
