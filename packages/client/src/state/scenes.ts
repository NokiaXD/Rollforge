import { computed, signal } from "@preact/signals";
import type { Scene } from "@rollforge/protocol";
import { currentSceneId } from "./scene";

export const scenes = signal<Map<string, Scene>>(new Map());

// this exists
// The scene THIS client renders. For GM = their camera; for Player = active scene.
// Derived from currentSceneId which itself is derived from role (see state/scene.ts).
export const viewedScene = computed<Scene | null>(() => scenes.value.get(currentSceneId.value) ?? null);

export function upsertScene(scene: Scene): void {
  const next = new Map(scenes.value);
  next.set(scene.id, scene);
  scenes.value = next;
}

export function removeScene(sceneId: string): void {
  if (!scenes.value.has(sceneId)) return;
  const next = new Map(scenes.value);
  next.delete(sceneId);
  scenes.value = next;
}
