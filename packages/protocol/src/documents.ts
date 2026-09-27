export type OwnershipLevel = "NONE" | "LIMITED" | "OBSERVER" | "OWNER";

export interface Document<TSystem = Record<string, unknown>> {
  id: string;
  type: string;
  name: string;
  img?: string;
  system: TSystem;
  flags: Record<string, Record<string, unknown>>;
  ownership: Record<string, OwnershipLevel> & { default?: OwnershipLevel };
  _rev: number;
}

export interface ActorSystem {
  hp: { value: number; max: number };
  notes: string;
}
export type Actor = Document<ActorSystem>;

export interface ItemSystem {
  quantity: number;
  weight: number;
}
export type Item = Document<ItemSystem>;

export interface SceneSystem {
  width: number;
  height: number;
  background: string | null;
  grid: { size: number; color: number; type: "square" | "hex" };
}
export type Scene = Document<SceneSystem>;

export interface MoveTokenIntent {
  type: "MoveToken";
  sceneId: string;
  tokenId: string;
  x: number;
  y: number;
  _rev: number;
}

export interface AcquireDragLockIntent {
  type: "AcquireDragLock";
  sceneId: string;
  tokenId: string;
}

export interface ReleaseDragLockIntent {
  type: "ReleaseDragLock";
  sceneId: string;
  tokenId: string;
}

export interface SetActiveSceneIntent {
  type: "SetActiveScene";
  sceneId: string;
}

export interface CreateSceneIntent {
  type: "CreateScene";
  sceneId: string;
  // ponytail: human-readable label. Defaults to sceneId on the server if empty.
  name: string;
  system: SceneSystem;
}

export interface UpdateSceneIntent {
  type: "UpdateScene";
  sceneId: string;
  name: string;
  system: SceneSystem;
}

export interface DeleteSceneIntent {
  type: "DeleteScene";
  sceneId: string;
}

export type Intent =
  | MoveTokenIntent
  | AcquireDragLockIntent
  | ReleaseDragLockIntent
  | SetActiveSceneIntent
  | CreateSceneIntent
  | UpdateSceneIntent
  | DeleteSceneIntent;

export interface TokenPositionDiff {
  type: "TokenPositionDiff";
  sceneId: string;
  tokenId: string;
  x: number;
  y: number;
  _rev: number;
}

export interface DragLockAcquiredEvent {
  type: "DragLockAcquired";
  sceneId: string;
  tokenId: string;
  ownerId: string;
}

export interface DragLockReleasedEvent {
  type: "DragLockReleased";
  sceneId: string;
  tokenId: string;
}

export interface ActiveSceneChangedEvent {
  type: "ActiveSceneChanged";
  sceneId: string;
}

export interface SceneCreatedEvent {
  type: "SceneCreated";
  sceneId: string;
  name: string;
  system: SceneSystem;
  _rev: number;
}

export interface SceneUpdatedEvent {
  type: "SceneUpdated";
  sceneId: string;
  name: string;
  system: SceneSystem;
  _rev: number;
}

export interface SceneDeletedEvent {
  type: "SceneDeleted";
  sceneId: string;
}

export type SceneEvent =
  | TokenPositionDiff
  | DragLockAcquiredEvent
  | DragLockReleasedEvent
  | ActiveSceneChangedEvent
  | SceneCreatedEvent
  | SceneUpdatedEvent
  | SceneDeletedEvent;