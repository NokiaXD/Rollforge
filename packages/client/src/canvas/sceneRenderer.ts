import type { Viewport } from "pixi-viewport";
import { effect } from "@preact/signals";
import type { Intent } from "@rollforge/protocol";
import { focusedTokenId, tokens, type Token } from "../state/scene";
import { TokenSprite } from "./tokens";

export class SceneRenderer {
  private sprites = new Map<string, TokenSprite>();
  private disposers: Array<() => void> = [];
  private viewport: Viewport;

  constructor(viewport: Viewport, sendIntent: (i: Intent) => void) {
    this.viewport = viewport;
    const off = effect(() => {
      this.reconcile(tokens.value, sendIntent);
    });
    this.disposers.push(off);

    // Escape clears focus globally. Lives on the renderer so its lifecycle matches the canvas.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") focusedTokenId.value = null;
    };
    window.addEventListener("keydown", onKey);
    this.disposers.push(() => window.removeEventListener("keydown", onKey));
  }

  destroy(): void {
    for (const d of this.disposers) d();
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
  }

  private reconcile(snapshot: Map<string, Token>, sendIntent: (i: Intent) => void): void {
    // Remove sprites whose tokens vanished
    for (const [id, sprite] of this.sprites) {
      if (!snapshot.has(id)) {
        sprite.destroy();
        this.sprites.delete(id);
      }
    }
    // Add or update
    for (const [id, token] of snapshot) {
      let sprite = this.sprites.get(id);
      if (!sprite) {
        sprite = new TokenSprite({ viewport: this.viewport, token, sendIntent });
        sprite.container.position.set(token.x, token.y);
        this.viewport.addChild(sprite.container);
        this.sprites.set(id, sprite);
      } else {
        sprite.applyRemote(token);
      }
    }
  }
}
