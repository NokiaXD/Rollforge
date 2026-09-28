import type { Server as SocketIOServer, Socket } from "socket.io";
import type {
  ActiveSceneChangedEvent,
  ChatHistoryEvent,
  ChatMessageEvent,
  Document,
  DragLockAcquiredEvent,
  DragLockReleasedEvent,
  Intent,
  SceneCreatedEvent,
  SceneDeletedEvent,
  SceneUpdatedEvent,
  TokenPositionDiff,
  RollActor,
  RollActorRef,
} from "@rollforge/protocol";
import type { SceneState, TokenRecord } from "./sceneState";
import type { ChatStore } from "../db/chatStore";
import type { DocumentStore } from "../db/documentStore";
import { authorize, authorizeAction, canRollAsCharacter } from "../security/authorize";
import { resolveChatMessage, type ChatResolution } from "../chat/resolve";
import { rollDice, validateDice, MAX_LEN_MESSAGE, HISTORY_PAGE } from "../dice/adapter";
import type { UsersStore } from "../auth/usersStore";

export interface SyncDeps {
  state: SceneState;
  // identity comes from Fase 1 (auth + JWT). For Fase 0 we mint from socket.id.
  resolveUserId?: (socket: Socket) => string;
  // resolveRole returns "GM" | "Player" | null. Default: socket.data.role ?? null.
  resolveRole?: (socket: Socket) => "GM" | "Player" | null;
  // username comes from the auth session. For Fase 0 / disabled auth, falls back to userId.
  resolveUsername?: (socket: Socket) => string;
  // per-client throttle cap on inbound MoveToken intents (Hz). 0 = disabled.
  moveHzCap?: number;
  // Paso 10: when true, non-GM intents targeting a sceneId != state.activeSceneId
  // are rejected with reason: "not-in-active-scene". Production server opts in;
  // unit tests opt out so they can target arbitrary scenes.
  gateSceneActive?: boolean;
  // Paso 11: chat persistence.
  chatStore: ChatStore | null;
  // Paso 11: username → userId resolution for whispers. Optional — when absent,
  // whispers fall back to rejecting with `not-found`.
  users?: UsersStore | null;
  // Paso 11: document store, used to look up the actor's character and verify
  // userId can roll on their behalf.
  documents?: DocumentStore | null;
}

interface ClientMoveBucket {
  windowStart: number;
  count: number;
}

interface ChatBucket {
  tokens: number;
  lastRefill: number;
}

// simple token bucket. 5 msg/s sustained, allows small bursts up to bucket cap.
const CHAT_RATE_CAP = 5;
const CHAT_RATE_INTERVAL_MS = 1000;

function consumeChatToken(buckets: Map<string, ChatBucket>, userId: string, now: number): boolean {
  let b = buckets.get(userId);
  if (!b) {
    b = { tokens: CHAT_RATE_CAP, lastRefill: now };
    buckets.set(userId, b);
  }
  const elapsed = now - b.lastRefill;
  if (elapsed >= CHAT_RATE_INTERVAL_MS) {
    b.tokens = CHAT_RATE_CAP;
    b.lastRefill = now;
  }
  if (b.tokens <= 0) return false;
  b.tokens -= 1;
  return true;
}

export function attachSync(io: SocketIOServer, deps: SyncDeps): void {
  const {
    state,
    resolveUserId,
    resolveRole,
    resolveUsername,
    moveHzCap = 0,
    gateSceneActive = false,
    chatStore,
    users = null,
    documents = null,
  } = deps;
  const moveBuckets = new Map<string, ClientMoveBucket>();
  const chatBuckets = new Map<string, ChatBucket>();

  io.on("connection", (socket) => {
    const userId = resolveUserId ? resolveUserId(socket) : `user-${socket.id}`;
    const role = resolveRole ? resolveRole(socket) : (socket.data.role ?? null);
    const isGM = role === "GM";
    const username = resolveUsername ? resolveUsername(socket) : userId;
    socket.data.userId = userId;
    socket.data.role = role;
    socket.data.username = username;

    // order matters. Both joins are synchronous so chatHistory is the first
    // thing this client sees — a chatMessage arriving on a parallel connection cannot
    // interleave before the history replacement.
    socket.join("world");
    socket.join(`user:${userId}`);
    if (chatStore) {
      const messages = chatStore.recent(HISTORY_PAGE);
      const history: ChatHistoryEvent = { type: "ChatHistory", messages };
      socket.emit("chatHistory", history);
    }
    socket.emit("you", { userId, role, username });
    socket.emit("event", {
      type: "ActiveSceneChanged",
      sceneId: state.getActiveSceneId(),
    } satisfies ActiveSceneChangedEvent);
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
      // gate only. Client doesn't listen to createToken rejections today;
      // silent drop is fine. Add a createTokenRejected event if a UI ever needs it.
      if (gateSceneActive && !isGM && payload.sceneId !== state.getActiveSceneId()) return;
      const id = `tok-${Math.random().toString(36).slice(2, 10)}`;
      const token = state.createToken(id, payload.sceneId, payload.x ?? 0, payload.y ?? 0, payload.w ?? 1, payload.h ?? 1);
      io.to(`scene:${payload.sceneId}`).emit("tokenCreated", token);
    });

    socket.on("intent", (intent: Intent) => {
      if (intent.type === "SendChatMessage") {
        if (!chatStore) return;
        processChat(io, socket, {
          userId,
          username,
          role: role ?? "Player",
          isGM,
        }, chatStore, chatBuckets, users, documents, {
          text: intent.text,
          ...(intent.actor !== undefined ? { actor: intent.actor } : {}),
        });
        return;
      }
      handleIntent(io, state, socket, userId, isGM, intent, moveBuckets, moveHzCap, gateSceneActive);
    });

    if (chatStore) {
      socket.on("chatMessage", (payload: { text: string; actor?: RollActorRef }) => {
        processChat(io, socket, {
          userId,
          username,
          role: role ?? "Player",
          isGM,
        }, chatStore, chatBuckets, users, documents, payload);
      });
    }

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
      chatBuckets.delete(userId);
    });
  });
}

interface ChatSender {
  userId: string;
  username: string;
  role: "GM" | "Player";
  isGM: boolean;
}

function processChat(
  io: SocketIOServer,
  socket: Socket,
  sender: ChatSender,
  chatStore: ChatStore,
  buckets: Map<string, ChatBucket>,
  users: UsersStore | null,
  documents: DocumentStore | null,
  payload: { text: string; actor?: RollActorRef },
): void {
  const text = typeof payload?.text === "string" ? payload.text : "";
  if (!authorizeAction(sender.userId, "SendChatMessage", sender.isGM)) {
    socket.emit("intentRejected", { intent: { type: "SendChatMessage", text }, reason: "forbidden" });
    return;
  }
  const now = Date.now();
  if (!consumeChatToken(buckets, sender.userId, now)) {
    socket.emit("intentRejected", { intent: { type: "SendChatMessage", text }, reason: "rate-limit" });
    return;
  }
  const resolution = resolveChatMessage(text, { limits: { maxLen: MAX_LEN_MESSAGE } });
  switch (resolution.kind) {
    case "reject":
      socket.emit("intentRejected", { intent: { type: "SendChatMessage", text }, reason: resolution.reason });
      return;
    case "chat": {
      const ev = chatStore.append({
        userId: sender.userId,
        username: sender.username,
        role: sender.role,
        kind: "chat",
        text: resolution.text,
        createdAt: now,
      });
      io.to("world").emit("chatMessage", ev);
      return;
    }
    case "whisper": {
      const recipient = users?.getByUsername(resolution.recipientUsername);
      if (!recipient) {
        socket.emit("intentRejected", { intent: { type: "SendChatMessage", text }, reason: "not-found" });
        return;
      }
      const ev: ChatMessageEvent = {
        type: "ChatMessage",
        seq: 0,
        id: `w-${now}-${sender.userId}`,
        userId: sender.userId,
        username: sender.username,
        role: sender.role,
        kind: "chat",
        text: resolution.text,
        whisperTo: recipient.username,
        createdAt: now,
      };
      io.to(`user:${sender.userId}`).to(`user:${recipient.username}`).emit("chatMessage", ev);
      return;
    }
    case "roll": {
      const valid = validateDice(resolution.notation);
      if (!valid.ok) {
        socket.emit("intentRejected", { intent: { type: "SendChatMessage", text }, reason: valid.reason });
        return;
      }
      let result;
      try {
        result = rollDice(resolution.notation);
      } catch {
        socket.emit("intentRejected", { intent: { type: "SendChatMessage", text }, reason: "bad-notation" });
        return;
      }
      const requestedActor = payload.actor ?? resolution.actor;
      let actor: RollActor;
      if (requestedActor?.type === "character") {
        const charDoc = documents?.getById(requestedActor.characterId) ?? null;
        if (!canRollAsCharacter(sender.userId, charDoc, sender.isGM)) {
          socket.emit("intentRejected", { intent: { type: "SendChatMessage", text }, reason: "forbidden" });
          return;
        }
        const name = charDoc?.name ?? "(unknown)";
        actor = { type: "character", characterId: requestedActor.characterId, name };
      } else {
        actor = { type: "user", userId: sender.userId, name: sender.username };
      }
      const ev = chatStore.append({
        userId: sender.userId,
        username: sender.username,
        role: sender.role,
        kind: "roll",
        text: resolution.text,
        rolls: result.terms.map((t) => t.roll),
        result,
        actor,
        createdAt: now,
      });
      io.to("world").emit("chatMessage", ev);
      return;
    }
  }
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
    case "SendChatMessage": {
      // unreachable: the intent dispatcher short-circuits this branch.
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
