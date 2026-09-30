import { effect, signal } from "@preact/signals";
import type { Scene, SceneEvent, SceneSystem } from "@rollforge/protocol";
import { currentUser } from "./auth";
import { viewedScene, removeScene, upsertScene } from "./scenes";
import { removeFolder, upsertFolder } from "./folders";

export interface Token {
  id: string;
  sceneId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  _rev: number;
}

// activeSceneId: server-controlled. What players see.
export const activeSceneId = signal<string>("default");
// gmCameraSceneId: GM's local navigation. What the GM is currently viewing.
// Players ignore this and follow activeSceneId.
export const gmCameraSceneId = signal<string>("default");
// currentSceneId: what THIS client renders, derived from role:
//   GM     -> gmCameraSceneId  (free navigation)
//   Player -> activeSceneId    (always follows)
// Updates via effect below; net/socket.ts watches this to emit joinScene/leaveScene.
export const currentSceneId = signal<string>("default");
export const myUserId = signal<string>("");
export const tokens = signal<Map<string, Token>>(new Map());
export const locks = signal<Map<string, string>>(new Map());
// brief error banner shown when an intent is rejected. Cleared on next user action.
export const lastError = signal<string | null>(null);
export const focusedTokenId = signal<string | null>(null);
// Driven by the rendered scene's grid size via the effect below. Tokens read this reactively.
export const cellSize = signal<number>(50);

effect(() => {
  const target = currentUser.value?.role === "GM" ? gmCameraSceneId.value : activeSceneId.value;
  if (currentSceneId.value !== target) currentSceneId.value = target;
});

// Sync cellSize from the rendered scene (not just active). The rendered scene's grid IS the cell size.
effect(() => {
  const scene = viewedScene.value;
  if (scene) cellSize.value = scene.system.grid.size;
});

export function upsertToken(token: Token): void {
  const next = new Map(tokens.value);
  next.set(token.id, token);
  tokens.value = next;
}

export function applyEvent(ev: SceneEvent): void {
  switch (ev.type) {
    case "TokenPositionDiff": {
      const t = tokens.value.get(ev.tokenId);
      if (!t) return;
      if (ev._rev <= t._rev) return;
      upsertToken({ ...t, x: ev.x, y: ev.y, _rev: ev._rev });
      return;
    }
    case "DragLockAcquired": {
      const next = new Map(locks.value);
      next.set(ev.tokenId, ev.ownerId);
      locks.value = next;
      return;
    }
    case "DragLockReleased": {
      if (!locks.value.has(ev.tokenId)) return;
      const next = new Map(locks.value);
      next.delete(ev.tokenId);
      locks.value = next;
      return;
    }
    case "SceneCreated":
    case "SceneUpdated": {
      const systemWithFolder: SceneSystem = { ...ev.system, folder: ev.folder ?? ev.system.folder ?? null };
      const doc: Scene = {
        id: ev.sceneId,
        type: "Scene",
        name: ev.name || ev.sceneId,
        system: systemWithFolder,
        flags: {},
        ownership: {},
        _rev: ev._rev,
      };
      if (ev.img !== undefined) doc.img = ev.img;
      upsertScene(doc);
      return;
    }
    case "SceneDeleted": {
      removeScene(ev.sceneId);
      return;
    }
    case "FolderCreated":
    case "FolderUpdated": {
      upsertFolder({
        id: ev.folderId,
        type: "Folder",
        name: ev.name || ev.folderId,
        system: {},
        flags: {},
        ownership: {},
        _rev: ev._rev,
      });
      return;
    }
    case "FolderDeleted": {
      removeFolder(ev.folderId);
      return;
    }
  }
}

export function resetScene(seed: Token[]): void {
  tokens.value = new Map(seed.map((t) => [t.id, t]));
  locks.value = new Map();
}
