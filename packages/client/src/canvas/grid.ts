import { Graphics } from "pixi.js";
import type { Viewport } from "pixi-viewport";

export function drawGrid(viewport: Viewport, worldSize: number, cellSize: number, color = 0x2c313a): Graphics {
  const grid = new Graphics();
  grid.x = 0;
  grid.y = 0;
  for (let i = 0; i <= worldSize; i += cellSize) {
    grid.moveTo(i, 0).lineTo(i, worldSize);
    grid.moveTo(0, i).lineTo(worldSize, i);
  }
  grid.stroke({ color, width: 1, alpha: 0.6 });
  viewport.addChild(grid);
  return grid;
}
