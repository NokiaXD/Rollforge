import { Graphics } from "pixi.js";
import type { Viewport } from "pixi-viewport";

export function drawGrid(
  viewport: Viewport,
  worldWidth: number,
  worldHeight: number,
  cellSize: number,
  color = 0x2c313a
): Graphics {
  const grid = new Graphics();
  grid.x = 0;
  grid.y = 0;
  for (let x = 0; x <= worldWidth; x += cellSize) {
    grid.moveTo(x, 0).lineTo(x, worldHeight);
  }
  for (let y = 0; y <= worldHeight; y += cellSize) {
    grid.moveTo(0, y).lineTo(worldWidth, y);
  }
  grid.stroke({ color, width: 1, alpha: 0.6 });
  viewport.addChild(grid);
  return grid;
}
