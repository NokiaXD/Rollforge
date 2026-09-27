import { Container, Graphics, Text, FederatedPointerEvent } from "pixi.js";
import type { Viewport } from "pixi-viewport";
import { effect } from "@preact/signals";
import type { Intent } from "@rollforge/protocol";
import type { Token } from "../state/scene";
import { cellSize, focusedTokenId, locks, myUserId } from "../state/scene";

const THROTTLE_MS = 50; // ~20Hz cap; client-side throttle per plan Paso 4.

const COLORS = {
  free: 0x4f8cff,
  own: 0xff9f43,
  lockedOther: 0x9b59b6,
  stroke: 0xffffff,
  focus: 0xffeb3b,
};

// snap position to nearest grid cell. Offset by half-cell so a 1x1 token center sits on a cell center, not a corner.
function snapToGrid(x: number, y: number, cell: number): { x: number; y: number } {
  const half = cell / 2;
  return {
    x: Math.round((x - half) / cell) * cell + half,
    y: Math.round((y - half) / cell) * cell + half,
  };
}

export interface TokenSpriteOptions {
  viewport: Viewport;
  token: Token;
  sendIntent: (intent: Intent) => void;
}

export class TokenSprite {
  readonly container: Container;
  private gfx: Graphics;
  private label: Text;
  private token: Token;
  private dragging = false;
  private pendingDrag = false;
  private lastSent = 0;
  private readonly viewport: Viewport;
  private readonly sendIntent: (i: Intent) => void;
  private disposers: Array<() => void> = [];

  // client-side tween state. Remote updates arrive at ~20Hz (THROTTLE_MS); we interpolate to 60fps.
  private targetX = 0;
  private targetY = 0;
  private tweenFromX = 0;
  private tweenFromY = 0;
  private tweenStart = 0;
  private tweening = false;
  private rafHandle: number | null = null;
  private static readonly TWEEN_MS = 80;

  constructor(opts: TokenSpriteOptions) {
    this.viewport = opts.viewport;
    this.token = opts.token;
    this.sendIntent = opts.sendIntent;
    this.targetX = opts.token.x;
    this.targetY = opts.token.y;

    this.container = new Container();
    this.container.eventMode = "static";
    this.container.cursor = "pointer";
    this.container.position.set(opts.token.x, opts.token.y);

    this.gfx = new Graphics();
    this.container.addChild(this.gfx);

    this.label = new Text({
      text: opts.token.id.slice(-3).toUpperCase(),
      style: { fill: 0xffffff, fontSize: 14, fontFamily: "system-ui" },
    });
    this.label.anchor.set(0.5);
    this.container.addChild(this.label);

    this.draw();

    this.container.on("pointerdown", this.onPointerDown);
    // pointertap fires on click without drag, so it doesn't conflict with the drag flow.
    this.container.on("pointertap", this.onPointerTap);

    this.startTweenLoop();

    // Reactive redraw on lock or focus change.
    const off = effect(() => {
      // touch both signals so the effect tracks them
      locks.value.get(this.token.id);
      myUserId.value;
      focusedTokenId.value;
      this.draw();
    });
    this.disposers.push(off);

    // Cleanup on destroy
    this.container.on("destroyed", () => {
      for (const d of this.disposers) d();
    });
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.stopTweenLoop();
    this.container.destroy({ children: true });
  }

  // snap the visual position to a value, cancelling any in-flight tween. Local drag uses this so the cursor stays 1:1.
  private syncTo(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
    this.container.position.set(x, y);
    this.tweening = false;
  }

  private startTweenLoop(): void {
    if (this.rafHandle !== null) return;
    const tick = () => {
      if (this.tweening && !this.dragging) {
        const elapsed = performance.now() - this.tweenStart;
        const f = Math.min(1, elapsed / TokenSprite.TWEEN_MS);
        this.container.position.x = this.tweenFromX + (this.targetX - this.tweenFromX) * f;
        this.container.position.y = this.tweenFromY + (this.targetY - this.tweenFromY) * f;
        if (f >= 1) this.tweening = false;
      }
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  private stopTweenLoop(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  applyRemote(token: Token): void {
    if (token._rev <= this.token._rev) return;
    this.token = token;
    if (this.dragging) return;
    this.tweenFromX = this.container.position.x;
    this.tweenFromY = this.container.position.y;
    this.targetX = token.x;
    this.targetY = token.y;
    this.tweenStart = performance.now();
    this.tweening = true;
  }

  private setLockedBy(ownerId: string | undefined, myId: string): void {
    // kept for symmetry; the lock effect now also redraws via the combined effect above.
    void ownerId;
    void myId;
  }

  private draw(): void {
    const lockOwner = locks.value.get(this.token.id);
    const me = myUserId.value;
    const focused = focusedTokenId.value === this.token.id;
    let fill = COLORS.free;
    if (lockOwner) fill = lockOwner === me ? COLORS.own : COLORS.lockedOther;
    const cell = cellSize.value;
    const w = this.token.w * cell;
    const h = this.token.h * cell;
    this.gfx.clear();
    this.gfx
      .roundRect(-w / 2, -h / 2, w, h, 6)
      .fill({ color: fill })
      .stroke({ color: focused ? COLORS.focus : COLORS.stroke, width: focused ? 4 : 2 });
    this.label.position.set(0, 0);
  }

  private onPointerTap = () => {
    focusedTokenId.value = this.token.id;
  };

  private onPointerDown = (e: FederatedPointerEvent) => {
    e.stopPropagation();
    this.pendingDrag = true;
    this.syncTo(this.container.position.x, this.container.position.y);
    this.sendIntent({
      type: "AcquireDragLock",
      sceneId: this.token.sceneId,
      tokenId: this.token.id,
    });
    this.viewport.eventMode = "static";
    this.viewport.on("pointermove", this.onViewportMove);
    this.viewport.once("pointerup", this.endDrag);
    this.viewport.once("pointerupoutside", this.endDrag);
  };

  private endDrag = () => {
    if (!this.pendingDrag && !this.dragging) return;
    this.dragging = false;
    this.pendingDrag = false;
    this.viewport.off("pointermove", this.onViewportMove);
    this.viewport.off("pointerup", this.endDrag);
    this.viewport.off("pointerupoutside", this.endDrag);
    const snapped = snapToGrid(this.container.position.x, this.container.position.y, cellSize.value);
    this.syncTo(snapped.x, snapped.y);
    this.sendIntent({
      type: "ReleaseDragLock",
      sceneId: this.token.sceneId,
      tokenId: this.token.id,
    });
    this.sendIntent({
      type: "MoveToken",
      sceneId: this.token.sceneId,
      tokenId: this.token.id,
      x: snapped.x,
      y: snapped.y,
      _rev: this.token._rev,
    });
  };

  private onViewportMove = (e: FederatedPointerEvent) => {
    if (!this.pendingDrag) return;
    if (!this.dragging) {
      const owner = locks.value.get(this.token.id);
      const me = myUserId.value;
      if (owner !== me) return;
      this.dragging = true;
    }
    const local = this.viewport.toWorld(e.global);
    this.syncTo(local.x, local.y);
    const now = Date.now();
    if (now - this.lastSent >= THROTTLE_MS) {
      this.lastSent = now;
      const snapped = snapToGrid(local.x, local.y, cellSize.value);
      this.sendIntent({
        type: "MoveToken",
        sceneId: this.token.sceneId,
        tokenId: this.token.id,
        x: snapped.x,
        y: snapped.y,
        _rev: this.token._rev,
      });
    }
  };
}
