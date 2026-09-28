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

let socket: Socket | null = null;
let lastJoinedScene: string | null = null;
let joinEffectInstalled = false;
// server already broadcasts ActiveSceneChanged on connect; first one seeds gmCameraSceneId
// so the GM opens on the active scene. After that the GM navigates freely via setGmCamera.
let initialActiveSync = true;

export function connectSocket(): Socket {
  if (socket) return socket;
  socket = io({ path: "/socket.io", transports: ["websocket"] });

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
    upsertToken({ ...token, sceneId: currentSceneId.value });
  });

  socket.on("chatMessage", (m: ChatMessageEvent) => {
    appendMessage(m);
    // ephemeral server rejections get echoed back to the user through
    // the same chatMessage socket that we already listen to. Show them inline.
    if (m.whisperTo === "") {
      // whisper not handled client-side yet (server resolves username → userId)
    }
  });

  socket.on("chatHistory", (h: ChatHistoryEvent) => {
    replaceMessages(h.messages);
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

export function createSceneRequest(sceneId: string, name: string, system: SceneSystem): void {
  sendIntent({ type: "CreateScene", sceneId, name, system });
}

export function updateSceneRequest(sceneId: string, name: string, system: SceneSystem): void {
  sendIntent({ type: "UpdateScene", sceneId, name, system });
}

export function deleteSceneRequest(sceneId: string): void {
  sendIntent({ type: "DeleteScene", sceneId });
}

export function sendIntent(intent: Intent): void {
  connectSocket().emit("intent", intent);
}

export function createTokenRequest(sceneId: string, x: number, y: number): void {
  connectSocket().emit("createToken", { sceneId, x, y });
}

export function sendChatMessage(text: string, actor?: RollActorRef): void {
  connectSocket().emit("chatMessage", { text, actor });
}
