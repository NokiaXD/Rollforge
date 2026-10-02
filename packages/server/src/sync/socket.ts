import { randomUUID } from "node:crypto";
import type { Server as SocketIOServer, Socket } from "socket.io";
import type {
  ActiveSceneChangedEvent,
  ChatHistoryEvent,
  ChatMessageEvent,
  Document,
  DragLockAcquiredEvent,
  DragLockReleasedEvent,
  FolderCreatedEvent,
  FolderDeletedEvent,
  FolderUpdatedEvent,
  Intent,
  SceneCreatedEvent,
  SceneDeletedEvent,
  SceneUpdatedEvent,
  TokenPositionDiff,
  RollActorRef,
  PreChatMessagePayload,
} from "@rollforge/protocol";
import type { SceneState, TokenRecord } from "./sceneState";
import type { ChatStore } from "../db/chatStore";
import type { DocumentStore } from "../db/documentStore";
import { authorize, authorizeAction } from "../security/authorize";
import { resolveChatMessage } from "../chat/resolve";
import { MAX_LEN_MESSAGE, HISTORY_PAGE } from "../dice/adapter";
import type { UsersStore } from "../auth/usersStore";
import type { ExtensionManager } from "../extensions/manager";
import { CommandRejection, type HooksEngine } from "@rollforge/extension-api";
import { invocationStorage } from "./invocationContext";

export interface SyncDeps {
  state: SceneState;
  resolveUserId?: (socket: Socket) => string;
  resolveRole?: (socket: Socket) => "GM" | "Player" | null;
  resolveUsername?: (socket: Socket) => string;
  moveHzCap?: number;
  gateSceneActive?: boolean;
  chatStore: ChatStore | null;
  users?: UsersStore | null;
  documents?: DocumentStore | null;
  extensionManager?: ExtensionManager;
  hooks?: HooksEngine;
}

interface ClientMoveBucket {
  windowStart: number;
  count: number;
}

interface ChatBucket {
  tokens: number;
  lastRefill: number;
}

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
    extensionManager,
    hooks,
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

    socket.join("world");
    socket.join(`user:${userId}`);
    socket.join(`user:${username}`);

    if (chatStore) {
      const messages = chatStore.recent(HISTORY_PAGE, {
        forUser: { userId, username },
      });
      const history: ChatHistoryEvent = { type: "ChatHistory", messages };
      socket.emit("chatHistory", history);
    }
    socket.emit("you", { userId, role, username });
    socket.emit("event", {
      type: "ActiveSceneChanged",
      sceneId: state.getActiveSceneId(),
    } satisfies ActiveSceneChangedEvent);
    for (const folder of state.listFolders()) {
      socket.emit("event", {
        type: "FolderCreated",
        folderId: folder.id,
        name: folder.name,
        _rev: folder._rev,
      } satisfies FolderCreatedEvent);
    }
    for (const scene of state.listScenes()) {
      socket.emit("event", {
        type: "SceneCreated",
        sceneId: scene.id,
        name: scene.name,
        system: scene.system,
        ...(scene.img !== undefined ? { img: scene.img } : {}),
        ...(scene.system.folder !== undefined && scene.system.folder !== null ? { folder: scene.system.folder } : {}),
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
      if (gateSceneActive && !isGM && payload.sceneId !== state.getActiveSceneId()) return;
      const id = `tok-${randomUUID()}`;
      const token = state.createToken(id, payload.sceneId, payload.x ?? 0, payload.y ?? 0, payload.w ?? 1, payload.h ?? 1);
      io.to(`scene:${payload.sceneId}`).emit("tokenCreated", token);
    });

    socket.on("intent", (intent: Intent) => {
      if (!intent || typeof intent !== "object" || typeof (intent as any).type !== "string") return;
      if (intent.type === "SendChatMessage") {
        if (!chatStore) return;
        void processChat(
          io,
          socket,
          {
            userId,
            username,
            role: role ?? "Player",
            isGM,
          },
          chatStore,
          chatBuckets,
          users,
          documents,
          {
            text: intent.text,
            ...(intent.actor !== undefined ? { actor: intent.actor } : {}),
          },
          extensionManager,
          hooks
        );
        return;
      }
      handleIntent(io, state, socket, userId, isGM, intent, moveBuckets, moveHzCap, gateSceneActive);
    });

    if (chatStore) {
      socket.on("chatMessage", (payload: { text: string; actor?: RollActorRef }) => {
        void processChat(
          io,
          socket,
          {
            userId,
            username,
            role: role ?? "Player",
            isGM,
          },
          chatStore,
          chatBuckets,
          users,
          documents,
          payload,
          extensionManager,
          hooks
        );
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

//defer extracting processChat to packages/server/src/chat/process.ts until 2+ command-dispatch paths exist or it exceeds ~180 lines.
async function processChat(
  io: SocketIOServer,
  socket: Socket,
  sender: ChatSender,
  chatStore: ChatStore,
  buckets: Map<string, ChatBucket>,
  _users: UsersStore | null,
  _documents: DocumentStore | null,
  payload: { text: string; actor?: RollActorRef },
  extensionManager?: ExtensionManager,
  hooks?: HooksEngine,
): Promise<void> {
  const rawText = typeof payload?.text === "string" ? payload.text : "";
  if (!authorizeAction(sender.userId, "SendChatMessage", sender.isGM)) {
    socket.emit("intentRejected", { intent: { type: "SendChatMessage", text: rawText }, reason: "forbidden" });
    return;
  }
  const now = Date.now();
  if (!consumeChatToken(buckets, sender.userId, now)) {
    socket.emit("intentRejected", { intent: { type: "SendChatMessage", text: rawText }, reason: "rate-limit" });
    return;
  }

  let text = rawText;
  if (hooks) {
    const prePayload: PreChatMessagePayload = {
      text: rawText,
      userId: sender.userId,
      isGM: sender.isGM,
    };
    const filtered = await hooks.runFilter("preChatMessage", prePayload);
    if (filtered === null) {
      return;
    }
    text = filtered.text;
  }

  const resolution = resolveChatMessage(text, { limits: { maxLen: MAX_LEN_MESSAGE } });
  if ("kind" in resolution) {
    socket.emit("intentRejected", { intent: { type: "SendChatMessage", text }, reason: resolution.reason });
    return;
  }

  if (resolution.command) {
    const cmdName = resolution.command;
    const contributed = extensionManager?.getContributedCommand(cmdName);
    const registered = extensionManager?.commandRegistry.get(cmdName);
    if (!contributed && !registered) {
      socket.emit("intentRejected", { intent: { type: "SendChatMessage", text }, reason: "not-a-command" });
      return;
    }

    if (extensionManager && !extensionManager.canInvoke(cmdName, sender.role)) {
      socket.emit("intentRejected", { intent: { type: "SendChatMessage", text }, reason: "forbidden" });
      return;
    }

    const extensionId = contributed?.extensionId ?? registered?.extensionId;
    if (extensionManager && extensionId) {
      try {
        await extensionManager.ensureActivated(extensionId);
      } catch {
        socket.emit("intentRejected", { intent: { type: "SendChatMessage", text }, reason: "extension-unavailable" });
        return;
      }
    }

    const activeCmd = extensionManager?.commandRegistry.get(cmdName);
    if (!activeCmd) {
      socket.emit("intentRejected", { intent: { type: "SendChatMessage", text }, reason: "extension-unavailable" });
      return;
    }

    try {
      await invocationStorage.run(
        {
          userId: sender.userId,
          username: sender.username,
          role: sender.role,
          isGM: sender.isGM,
          ...(payload.actor !== undefined ? { actor: payload.actor } : {}),
        },
        async () => {
          await activeCmd.handler(
            { args: resolution.args, rest: resolution.rest },
            { userId: sender.userId, isGM: sender.isGM }
          );
        }
      );
    } catch (err: any) {
      if (err instanceof CommandRejection) {
        socket.emit("intentRejected", { intent: { type: "SendChatMessage", text }, reason: err.reason });
      } else {
        console.error(`[extension:${activeCmd.extensionId}] command "${cmdName}" failed:`, err);
        socket.emit("intentRejected", { intent: { type: "SendChatMessage", text }, reason: "command-failed" });
      }
    }
    return;
  }

  const ev = chatStore.append({
    userId: sender.userId,
    username: sender.username,
    role: sender.role,
    kind: "chat",
    text: resolution.rest,
    createdAt: now,
  });
  io.to("world").emit("chatMessage", ev);
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
      const ev: ActiveSceneChangedEvent = {
        type: "ActiveSceneChanged",
        sceneId: intent.sceneId,
      };
      io.emit("event", ev);
      return;
    }
    case "CreateScene": {
      if (!isGM) {
        socket.emit("intentRejected", { intent, reason: "forbidden" });
        return;
      }
      if (typeof intent.sceneId !== "string" || !intent.sceneId) {
        socket.emit("intentRejected", { intent, reason: "invalid" });
        return;
      }
      const name = typeof intent.name === "string" && intent.name.trim() ? intent.name.trim() : intent.sceneId;
      const created = state.createScene(
        intent.sceneId,
        name,
        intent.system,
        intent.img ?? null,
        intent.folder ?? null,
      );
      if (!created) {
        socket.emit("intentRejected", { intent, reason: "conflict" });
        return;
      }
      const ev: SceneCreatedEvent = {
        type: "SceneCreated",
        sceneId: created.id,
        name: created.name,
        system: created.system,
        ...(created.img !== undefined ? { img: created.img } : {}),
        ...(created.system.folder !== undefined && created.system.folder !== null ? { folder: created.system.folder } : {}),
        _rev: created._rev,
      };
      io.emit("event", ev);
      return;
    }
    case "UpdateScene": {
      if (!isGM) {
        socket.emit("intentRejected", { intent, reason: "forbidden" });
        return;
      }
      if (typeof intent.sceneId !== "string" || !intent.sceneId) {
        socket.emit("intentRejected", { intent, reason: "invalid" });
        return;
      }
      const name = typeof intent.name === "string" && intent.name.trim() ? intent.name.trim() : intent.sceneId;
      const updated = state.updateScene(
        intent.sceneId,
        name,
        intent.system,
        intent.img,
        intent.folder ?? null,
      );
      if (!updated) {
        socket.emit("intentRejected", { intent, reason: "not-found" });
        return;
      }
      const ev: SceneUpdatedEvent = {
        type: "SceneUpdated",
        sceneId: updated.id,
        name: updated.name,
        system: updated.system,
        ...(updated.img !== undefined ? { img: updated.img } : {}),
        ...(updated.system.folder !== undefined && updated.system.folder !== null ? { folder: updated.system.folder } : {}),
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
      const wasActive = state.getActiveSceneId() === intent.sceneId;
      const deleted = state.deleteScene(intent.sceneId);
      if (!deleted) {
        socket.emit("intentRejected", { intent, reason: "not-found" });
        return;
      }
      const ev: SceneDeletedEvent = { type: "SceneDeleted", sceneId: intent.sceneId };
      io.emit("event", ev);
      if (wasActive) {
        state.setActiveSceneId("default");
        const fallback: ActiveSceneChangedEvent = { type: "ActiveSceneChanged", sceneId: "default" };
        io.emit("event", fallback);
      }
      return;
    }
    case "MoveScene": {
      if (!isGM) {
        socket.emit("intentRejected", { intent, reason: "forbidden" });
        return;
      }
      if (typeof intent.sceneId !== "string" || !intent.sceneId) {
        socket.emit("intentRejected", { intent, reason: "invalid" });
        return;
      }
      const folder = typeof intent.folder === "string" && intent.folder ? intent.folder : null;
      const updated = state.moveScene(intent.sceneId, folder, intent.index);
      if (!updated) {
        socket.emit("intentRejected", { intent, reason: "not-found" });
        return;
      }
      const ev: SceneUpdatedEvent = {
        type: "SceneUpdated",
        sceneId: updated.id,
        name: updated.name,
        system: updated.system,
        ...(updated.img !== undefined ? { img: updated.img } : {}),
        ...(updated.system.folder !== undefined && updated.system.folder !== null ? { folder: updated.system.folder } : {}),
        _rev: updated._rev,
      };
      io.emit("event", ev);
      return;
    }
    case "CreateFolder": {
      if (!isGM) {
        socket.emit("intentRejected", { intent, reason: "forbidden" });
        return;
      }
      if (typeof intent.folderId !== "string" || !intent.folderId) {
        socket.emit("intentRejected", { intent, reason: "invalid" });
        return;
      }
      const name = typeof intent.name === "string" && intent.name.trim() ? intent.name.trim() : intent.folderId;
      let created;
      try {
        created = state.createFolder(intent.folderId, name);
      } catch {
        socket.emit("intentRejected", { intent, reason: "conflict" });
        return;
      }
      const ev: FolderCreatedEvent = {
        type: "FolderCreated",
        folderId: created.id,
        name: created.name,
        _rev: created._rev,
      };
      io.emit("event", ev);
      return;
    }
    case "UpdateFolder": {
      if (!isGM) {
        socket.emit("intentRejected", { intent, reason: "forbidden" });
        return;
      }
      if (typeof intent.folderId !== "string" || !intent.folderId) {
        socket.emit("intentRejected", { intent, reason: "invalid" });
        return;
      }
      const name = typeof intent.name === "string" && intent.name.trim() ? intent.name.trim() : intent.folderId;
      const updated = state.updateFolder(intent.folderId, name);
      if (!updated) {
        socket.emit("intentRejected", { intent, reason: "not-found" });
        return;
      }
      const ev: FolderUpdatedEvent = {
        type: "FolderUpdated",
        folderId: updated.id,
        name: updated.name,
        _rev: updated._rev,
      };
      io.emit("event", ev);
      return;
    }
    case "DeleteFolder": {
      if (!isGM) {
        socket.emit("intentRejected", { intent, reason: "forbidden" });
        return;
      }
      if (typeof intent.folderId !== "string" || !intent.folderId) {
        socket.emit("intentRejected", { intent, reason: "invalid" });
        return;
      }
      const { deletedFolders, orphanedScenes } = state.deleteFolder(intent.folderId);
      if (deletedFolders.length === 0) {
        socket.emit("intentRejected", { intent, reason: "not-found" });
        return;
      }
      for (const fid of deletedFolders) {
        const ev: FolderDeletedEvent = { type: "FolderDeleted", folderId: fid };
        io.emit("event", ev);
      }
      for (const scene of orphanedScenes) {
        const ev: SceneUpdatedEvent = {
          type: "SceneUpdated",
          sceneId: scene.id,
          name: scene.name,
          system: scene.system,
          ...(scene.img !== undefined ? { img: scene.img } : {}),
          ...(scene.system.folder !== undefined && scene.system.folder !== null ? { folder: scene.system.folder } : {}),
          _rev: scene._rev,
        };
        io.emit("event", ev);
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
      return;
    }
  }
}

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

// authorize() only reads doc.ownership; defer trimming tokenOwnershipDoc synthetic fields until authorize signature grows.
function tokenOwnershipDoc(token: TokenRecord): Document<unknown> {
  return {
    id: token.id,
    type: "Token",
    name: token.id,
    system: { sceneId: token.sceneId, x: token.x, y: token.y, w: token.w, h: token.h },
    flags: {},
    ownership: token.ownership,
    schemaVersion: 0,
    migrationStatus: "ok",
    _rev: token._rev,
  };
}
