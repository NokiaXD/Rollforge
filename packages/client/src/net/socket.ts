import { io, type Socket } from "socket.io-client";
import { effect } from "@preact/signals";
import type {
  ChatHistoryEvent,
  ChatMessageEvent,
  Intent,
  RollActorRef,
  SceneEvent,
  SceneSystem,
} from "@rollforge/protocol";
import {
  activeSceneId,
  applyEvent,
  currentSceneId,
  gmCameraSceneId,
  lastError,
  myUserId,
  resetScene,
  upsertToken,
  type Token,
} from "../state/scene";
import { appendMessage, replaceMessages } from "../state/chat";
import { upsertDocument, removeDocument } from "../state/documents";
import { closeDocument } from "../state/ui";
import { shouldShowChatToast, formatChatToastText } from "../state/layoutTransitions";
import {
  panelDocks,
  leftSidebarOpen,
  rightSidebarOpen,
  activeLeftTab,
  activeRightTab,
} from "../state/layout";
import { addToast } from "../state/toasts";

let socket: Socket | null = null;
let lastJoinedScene: string | null = null;
let joinEffectInstalled = false;
// server already broadcasts ActiveSceneChanged on connect; first one seeds gmCameraSceneId
// so the GM opens on the active scene. After that the GM navigates freely via setGmCamera.
let initialActiveSync = true;

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  lastJoinedScene = null;
  initialActiveSync = true;
}

export function connectSocket(): Socket {
  if (socket) return socket;
  socket = io({ path: "/socket.io", transports: ["websocket"] });

  const currentId = currentSceneId.value;
  if (currentId) {
    socket.emit("joinScene", currentId, (payload: { tokens: Token[] }) => {
      resetScene(
        payload.tokens.map((t) => ({
          ...t,
          sceneId: currentId,
        })),
      );
    });
    lastJoinedScene = currentId;
  }

  socket.on("you", (payload: { userId: string }) => {
    myUserId.value = payload.userId;
  });

  socket.on("event", (ev: SceneEvent) => {
    if (ev.type === "ActiveSceneChanged") {
      // Server-controlled. Players' currentSceneId follows via the effect in state/scene.ts.
      // GMs ignore this for their camera (they navigate freely).
      activeSceneId.value = ev.sceneId;
      if (initialActiveSync) {
        initialActiveSync = false;
        gmCameraSceneId.value = ev.sceneId;
      }
      return;
    }
    applyEvent(ev);
  });

  // surface server rejections — the GmPanel needs to know when a CreateScene
  // bounces so it can show an error instead of a fake "Scene created" success.
  socket.on("intentRejected", (r: { intent: Intent; reason: string }) => {
    lastError.value = `${r.intent.type}: ${r.reason}`;
    setTimeout(() => {
      if (lastError.value === `${r.intent.type}: ${r.reason}`) lastError.value = null;
    }, 4000);
  });

  socket.on("tokenCreated", (token: Token) => {
    // trust server; if scoping ever breaks, add a sceneId guard here
    upsertToken(token);
  });

  socket.on("chatMessage", (m: ChatMessageEvent) => {
    appendMessage(m);

    const chatDock = panelDocks.value.chat ?? "right";
    if (
      shouldShowChatToast(
        false,
        chatDock,
        leftSidebarOpen.value,
        rightSidebarOpen.value,
        activeLeftTab.value,
        activeRightTab.value,
      )
    ) {
      addToast({
        text: formatChatToastText(m),
        kind: m.result ? "chat" : "info",
      });
    }

    if (m.whisperTo === "") {
      // whisper not handled client-side yet (server resolves username → userId)
    }
  });

  socket.on("chatHistory", (h: ChatHistoryEvent) => {
    replaceMessages(h.messages);
  });

  socket.on("documentUpdated", (ev: { type: "DocumentUpdated"; document: import("@rollforge/protocol").Document }) => {
    upsertDocument(ev.document);
  });

  socket.on("documentDeleted", (ev: { type: "DocumentDeleted"; id: string }) => {
    removeDocument(ev.id);
    closeDocument(ev.id);
  });

  // Sync joinScene/leaveScene with currentSceneId (derived from role).
  // This handles Player auto-following active, and GM free navigation.
  if (!joinEffectInstalled) {
    joinEffectInstalled = true;
    effect(() => {
      const id = currentSceneId.value;
      if (!socket) return;
      if (id === lastJoinedScene) return;
      const s = socket;
      if (lastJoinedScene !== null) s.emit("leaveScene", lastJoinedScene);
      s.emit("joinScene", id, (payload: { tokens: Token[] }) => {
        resetScene(
          payload.tokens.map((t) => ({
            ...t,
            sceneId: id,
          })),
        );
      });
      lastJoinedScene = id;
    });
  }

  return socket;
}

export function setGmCamera(sceneId: string): void {
  // GM-only: locally navigate to a scene without dragging players along.
  // The effect in state/scene.ts will sync currentSceneId, which then triggers joinScene.
  gmCameraSceneId.value = sceneId;
}

export function setActiveSceneAsGM(sceneId: string): void {
  // Broadcast to everyone (including us). The server echoes ActiveSceneChanged back.
  sendIntent({ type: "SetActiveScene", sceneId });
}

export function createSceneRequest(sceneId: string, name: string, system: SceneSystem, img?: string | null, folder?: string | null): void {
  sendIntent({ type: "CreateScene", sceneId, name, system, ...(img !== undefined ? { img } : {}), ...(folder !== undefined ? { folder } : {}) });
}

export function updateSceneRequest(sceneId: string, name: string, system: SceneSystem, img?: string | null, folder?: string | null): void {
  sendIntent({ type: "UpdateScene", sceneId, name, system, ...(img !== undefined ? { img } : {}), ...(folder !== undefined ? { folder } : {}) });
}

export function createFolderRequest(folderId: string, name: string): void {
  sendIntent({ type: "CreateFolder", folderId, name });
}

export function updateFolderRequest(folderId: string, name: string): void {
  sendIntent({ type: "UpdateFolder", folderId, name });
}

export function deleteFolderRequest(folderId: string): void {
  sendIntent({ type: "DeleteFolder", folderId });
}

export function deleteSceneRequest(sceneId: string): void {
  sendIntent({ type: "DeleteScene", sceneId });
}

export function moveSceneRequest(sceneId: string, folder: string | null, index: number): void {
  sendIntent({ type: "MoveScene", sceneId, ...(folder !== null ? { folder } : {}), index });
}

export function sendIntent(intent: Intent): void {
  connectSocket().emit("intent", intent);
}

export function createTokenRequest(sceneId: string, x: number, y: number): void {
  connectSocket().emit("createToken", { sceneId, x, y });
}

export function deleteTokenRequest(sceneId: string, tokenId: string): void {
  sendIntent({ type: "DeleteToken", sceneId, tokenId });
}

export function sendChatMessage(text: string, actor?: RollActorRef): void {
  connectSocket().emit("chatMessage", { text, actor });
}
