import type { Server as SocketIOServer, Socket } from "socket.io";
import type {
  ActiveSceneChangedEvent,
  Document,
  DragLockAcquiredEvent,
  DragLockReleasedEvent,
  Intent,
  SceneCreatedEvent,
  SceneDeletedEvent,
  SceneUpdatedEvent,
  TokenPositionDiff,
} from "@rollforge/protocol";
import { SceneState, type TokenRecord } from "./sceneState";
import { authorize } from "../security/authorize";

export interface SyncDeps {
  state: SceneState;
  // identity comes from Fase 1 (auth + JWT). For Fase 0 we mint from socket.id.
  resolveUserId?: (socket: Socket) => string;
  // resolveRole returns "GM" | "Player" | null. Default: socket.data.role ?? null.
  resolveRole?: (socket: Socket) => "GM" | "Player" | null;
  // per-client throttle cap on inbound MoveToken intents (Hz). 0 = disabled.
  moveHzCap?: number;
  // Paso 10: when true, non-GM intents targeting a sceneId != state.activeSceneId
  // are rejected with reason: "not-in-active-scene". Production server opts in;
  // unit tests opt out so they can target arbitrary scenes.
  gateSceneActive?: boolean;
}

interface ClientMoveBucket {
  windowStart: number;
  count: number;
}

export function attachSync(io: SocketIOServer, deps: SyncDeps): void {
  const { state, resolveUserId, resolveRole, moveHzCap = 0, gateSceneActive = false } = deps;
  const moveBuckets = new Map<string, ClientMoveBucket>();

  io.on("connection", (socket) => {
    const userId = resolveUserId ? resolveUserId(socket) : `user-${socket.id}`;
    const role = resolveRole ? resolveRole(socket) : (socket.data.role ?? null);
    const isGM = role === "GM";
    socket.data.userId = userId;
    socket.data.role = role;
    socket.emit("you", { userId, role });
    // Tell the new client what the active scene is so it can auto-join.
    socket.emit("event", { type: "ActiveSceneChanged", sceneId: state.getActiveSceneId() } satisfies ActiveSceneChangedEvent);
    // Replay existing scenes so the client can populate its scene list / dropdown.
    for (const scene of state.listScenes()) {
      socket.emit("event", {
        type: "SceneCreated",
        sceneId: scene.id,
        name: scene.name,
        system: scene.system,
        _rev: scene._rev,
      } satisfies SceneCreatedEvent);
    }

    socket.on("joinScene", (sceneId: string, ack?: (payload: { tokens: ReturnType<SceneState["getSceneTokens"]> }) => void) => {
      if (typeof sceneId !== "string" || !sceneId) return;
      socket.join(`scene:${sceneId}`);
      ack?.({ tokens: state.getSceneTokens(sceneId) });
    });

    socket.on("leaveScene", (sceneId: string) => {
      if (typeof sceneId !== "string") return;
      socket.leave(`scene:${sceneId}`);
    });

    socket.on("createToken", (payload: { sceneId: string; x?: number; y?: number; w?: number; h?: number }) => {
      if (!payload || typeof payload.sceneId !== "string") return;
      // ponytail: gate only. Client doesn't listen to createToken rejections today;
      // silent drop is fine. Add a createTokenRejected event if a UI ever needs it.
      if (gateSceneActive && !isGM && payload.sceneId !== state.getActiveSceneId()) return;
      const id = `tok-${Math.random().toString(36).slice(2, 10)}`;
      const token = state.createToken(id, payload.sceneId, payload.x ?? 0, payload.y ?? 0, payload.w ?? 1, payload.h ?? 1);
      io.to(`scene:${payload.sceneId}`).emit("tokenCreated", token);
    });

    socket.on("intent", (intent: Intent) => {
      handleIntent(io, state, socket, userId, isGM, intent, moveBuckets, moveHzCap, gateSceneActive);
    });

    socket.on("disconnect", () => {
      const released = state.releaseAllFor(userId);
      for (const tokenId of released) {
        const ev: DragLockReleasedEvent = {
          type: "DragLockReleased",
          sceneId: state.getToken(tokenId)?.sceneId ?? "",
          tokenId,
        };
        io.emit("event", ev);
      }
      moveBuckets.delete(userId);
    });
  });
}

function handleIntent(
  io: SocketIOServer,
  state: SceneState,
  socket: Socket,
  userId: string,
  isGM: boolean,
  intent: Intent,
  buckets: Map<string, ClientMoveBucket>,
  moveHzCap: number,
  gateSceneActive: boolean,
): void {
  switch (intent.type) {
    case "SetActiveScene": {
      if (!isGM) {
        socket.emit("intentRejected", { intent, reason: "forbidden" });
        return;
      }
      if (!state.getScene(intent.sceneId)) {
        socket.emit("intentRejected", { intent, reason: "not-found" });
        return;
      }
      state.setActiveSceneId(intent.sceneId);
      const ev: ActiveSceneChangedEvent = { type: "ActiveSceneChanged", sceneId: intent.sceneId };
      io.emit("event", ev);
      return;
    }
    case "CreateScene": {
      if (!isGM) {
        socket.emit("intentRejected", { intent, reason: "forbidden" });
        return;
      }
      if (typeof intent.sceneId !== "string" || !intent.sceneId || !intent.system) {
        socket.emit("intentRejected", { intent, reason: "invalid" });
        return;
      }
      const name = typeof intent.name === "string" && intent.name.trim() ? intent.name.trim() : intent.sceneId;
      let doc;
      try {
        doc = state.createScene(intent.sceneId, name, intent.system);
      } catch {
        socket.emit("intentRejected", { intent, reason: "conflict" });
        return;
      }
      const ev: SceneCreatedEvent = {
        type: "SceneCreated",
        sceneId: doc.id,
        name: doc.name,
        system: doc.system,
        _rev: doc._rev,
      };
      io.emit("event", ev);
      return;
    }
    case "UpdateScene": {
      if (!isGM) {
        socket.emit("intentRejected", { intent, reason: "forbidden" });
        return;
      }
      if (typeof intent.sceneId !== "string" || !intent.system) {
        socket.emit("intentRejected", { intent, reason: "invalid" });
        return;
      }
      const name = typeof intent.name === "string" && intent.name.trim() ? intent.name.trim() : intent.sceneId;
      const updated = state.updateScene(intent.sceneId, name, intent.system);
      if (!updated) {
        socket.emit("intentRejected", { intent, reason: "not-found" });
        return;
      }
      const ev: SceneUpdatedEvent = {
        type: "SceneUpdated",
        sceneId: updated.id,
        name: updated.name,
        system: updated.system,
        _rev: updated._rev,
      };
      io.emit("event", ev);
      return;
    }
    case "DeleteScene": {
      if (!isGM) {
        socket.emit("intentRejected", { intent, reason: "forbidden" });
        return;
      }
      if (typeof intent.sceneId !== "string" || !intent.sceneId) {
        socket.emit("intentRejected", { intent, reason: "invalid" });
        return;
      }
      const deleted = state.deleteScene(intent.sceneId);
      if (!deleted) {
        socket.emit("intentRejected", { intent, reason: "not-found" });
        return;
      }
      const ev: SceneDeletedEvent = { type: "SceneDeleted", sceneId: intent.sceneId };
      io.emit("event", ev);
      // If we deleted the active scene, fall back to "default" (always exists).
      if (state.getActiveSceneId() === intent.sceneId) {
        state.setActiveSceneId("default");
        const fallback: ActiveSceneChangedEvent = { type: "ActiveSceneChanged", sceneId: "default" };
        io.emit("event", fallback);
      }
      return;
    }
    case "AcquireDragLock": {
      const token = state.getToken(intent.tokenId);
      if (!token) {
        socket.emit("intentRejected", { intent, reason: "not-found" });
        return;
      }
      if (gateSceneActive && !isGM && token.sceneId !== state.getActiveSceneId()) {
        socket.emit("intentRejected", { intent, reason: "not-in-active-scene" });
        return;
      }
      if (!authorize(userId, "AcquireDragLock", tokenOwnershipDoc(token), isGM)) {
        socket.emit("intentRejected", { intent, reason: "forbidden" });
        return;
      }
      const lock = state.acquireLock(intent.tokenId, userId);
      if (!lock) {
        socket.emit("intentRejected", { intent, reason: "locked" });
        return;
      }
      const ev: DragLockAcquiredEvent = {
        type: "DragLockAcquired",
        sceneId: intent.sceneId,
        tokenId: intent.tokenId,
        ownerId: userId,
      };
      io.to(`scene:${intent.sceneId}`).emit("event", ev);
      return;
    }
    case "ReleaseDragLock": {
      const token = state.getToken(intent.tokenId);
      if (!token) return;
      if (gateSceneActive && !isGM && token.sceneId !== state.getActiveSceneId()) {
        socket.emit("intentRejected", { intent, reason: "not-in-active-scene" });
        return;
      }
      if (!authorize(userId, "ReleaseDragLock", tokenOwnershipDoc(token), isGM)) {
        socket.emit("intentRejected", { intent, reason: "forbidden" });
        return;
      }
      if (!state.releaseLock(intent.tokenId, userId)) return;
      const ev: DragLockReleasedEvent = {
        type: "DragLockReleased",
        sceneId: intent.sceneId,
        tokenId: intent.tokenId,
      };
      io.to(`scene:${intent.sceneId}`).emit("event", ev);
      return;
    }
    case "MoveToken": {
      const token = state.getToken(intent.tokenId);
      if (!token) {
        socket.emit("intentRejected", { intent, reason: "not-found" });
        return;
      }
      if (gateSceneActive && !isGM && token.sceneId !== state.getActiveSceneId()) {
        socket.emit("intentRejected", { intent, reason: "not-in-active-scene" });
        return;
      }
      if (!authorize(userId, "MoveToken", tokenOwnershipDoc(token), isGM)) {
        socket.emit("intentRejected", { intent, reason: "forbidden" });
        return;
      }
      if (moveHzCap > 0 && !consumeBucket(buckets, userId, moveHzCap)) return;
      const updated = state.moveToken(intent.tokenId, userId, intent.x, intent.y, intent._rev);
      if (!updated) {
        socket.emit("intentRejected", { intent, reason: "stale-or-locked" });
        return;
      }
      const diff: TokenPositionDiff = {
        type: "TokenPositionDiff",
        sceneId: intent.sceneId,
        tokenId: intent.tokenId,
        x: intent.x,
        y: intent.y,
        _rev: updated._rev,
      };
      io.to(`scene:${intent.sceneId}`).emit("event", diff);
      return;
    }
  }
}

// 1Hz-window bucket — coarse but enough to cap a runaway client.
function consumeBucket(buckets: Map<string, ClientMoveBucket>, userId: string, cap: number): boolean {
  const now = Date.now();
  let bucket = buckets.get(userId);
  if (!bucket || now - bucket.windowStart >= 1000) {
    bucket = { windowStart: now, count: 0 };
    buckets.set(userId, bucket);
  }
  if (bucket.count >= cap) return false;
  bucket.count += 1;
  return true;
}

function tokenOwnershipDoc(token: TokenRecord): Document<unknown> {
  return {
    id: token.id,
    type: "Token",
    name: token.id,
    system: { sceneId: token.sceneId, x: token.x, y: token.y, w: token.w, h: token.h },
    flags: {},
    ownership: token.ownership,
    _rev: token._rev,
  };
}
