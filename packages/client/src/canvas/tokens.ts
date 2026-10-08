import { Container, Graphics, FederatedPointerEvent } from "pixi.js";
import type { Viewport } from "pixi-viewport";
import { effect } from "@preact/signals";
import type { Intent } from "@rollforge/protocol";
import type { Token } from "../state/scene";
import { cellSize, focusedTokenId, locks, myUserId } from "../state/scene";
import { identiconCells, tokenSeed, type IdenticonCells } from "./identicon";

const THROTTLE_MS = 50; // ~20Hz cap; client-side throttle per plan Paso 4.

//  The identicon owns the token's interior, so lock state lives on the border —
//  before, the fill was the only lock signal and a background image would have
//  silently erased it. Unlocked + unfocused = no border at all.
const COLORS = {
  own: 0xff9f43,
  lockedOther: 0x9b59b6,
  stroke: 0xffffff,
  focus: 0xffeb3b,
  empty: 0x1c212a,
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
  private token: Token;
  /** parsed once: minidenticons is a pure seed -> SVG function, so this never changes. */
  private readonly identicon: IdenticonCells;
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

    this.identicon = identiconCells(tokenSeed(opts.token.id));

    this.gfx = new Graphics();
    this.container.addChild(this.gfx);

    this.draw();

    this.container.on("pointerdown", this.onPointerDown);
    // pointertap fires on click without drag, so it doesn't conflict with the drag flow.
    this.container.on("pointertap", this.onPointerTap);

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
    this.stopTweenLoop();
  }

  private startTweenLoop(): void {
    if (this.rafHandle !== null) return;
    const tick = () => {
      if (this.tweening && !this.dragging) {
        const elapsed = performance.now() - this.tweenStart;
        const f = Math.min(1, elapsed / TokenSprite.TWEEN_MS);
        this.container.position.x = this.tweenFromX + (this.targetX - this.tweenFromX) * f;
        this.container.position.y = this.tweenFromY + (this.targetY - this.tweenFromY) * f;
        if (f >= 1) {
          this.tweening = false;
          this.rafHandle = null;
          return;
        }
      } else {
        this.tweening = false;
        this.rafHandle = null;
        return;
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
    this.startTweenLoop();
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
    //  No border unless something has to say: an unlocused, unlocked token draws
    //  nothing. The identicon is the token; a permanent ring just boxes it in.
    const border = lockOwner
      ? lockOwner === me
        ? COLORS.own
        : COLORS.lockedOther
      : focused
        ? COLORS.focus
        : null;
    const cell = cellSize.value;
    const w = this.token.w * cell;
    const h = this.token.h * cell;
    this.gfx.clear();
    this.gfx.roundRect(-w / 2, -h / 2, w, h, 6).fill({ color: COLORS.empty });
    if (border !== null) {
      this.gfx.stroke({ color: border, width: focused ? 4 : 2 });
    }

    // 5x5 identicon inset by 2px so it never sits under the border. Drawn as plain
    // rects: same sync Graphics path the roundRect already used, so a token needs no
    // texture load and there is no blank frame between "token created" and "visible".
    const pad = 2;
    const gw = w - pad * 2;
    const gh = h - pad * 2;
    if (gw <= 0 || gh <= 0) return;
    const cw = gw / 5;
    const ch = gh / 5;
    const fill = `hsl(${this.identicon.hue} 95% 45%)`;
    for (const [cx, cy] of this.identicon.cells) {
      this.gfx.rect(-gw / 2 + cx * cw, -gh / 2 + cy * ch, cw, ch).fill(fill);
    }
  }

  private onPointerTap = () => {
    focusedTokenId.value = this.token.id;
  };

  private onPointerDown = (e: FederatedPointerEvent) => {
    //  only left-button starts a drag. Right/middle are reserved for
    // viewport pan and our context menu; without this guard, right-clicking a
    // token would silently acquire its drag lock.
    if (e.button !== 0) return;
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
    this.sendMove(snapped.x, snapped.y);
  };

  private sendMove(snappedX: number, snappedY: number): void {
    const rev = this.token._rev;
    //  optimistic _rev bump — server's TokenPositionDiff takes a round trip
    // to come back, but we send the next throttled MoveToken 50ms later, often before
    // the diff arrives. Without this bump the next packet carries the rev we already
    // consumed and the server correctly rejects it as stale.
    this.token = { ...this.token, _rev: rev + 1 };
    this.sendIntent({
      type: "MoveToken",
      sceneId: this.token.sceneId,
      tokenId: this.token.id,
      x: snappedX,
      y: snappedY,
      _rev: rev,
    });
  }

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
      this.sendMove(snapped.x, snapped.y);
    }
  };
}
