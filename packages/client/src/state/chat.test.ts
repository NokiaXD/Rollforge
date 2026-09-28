import { describe, it, expect, beforeEach } from "vitest";
import {
  appendMessage,
  replaceMessages,
  chatDraft,
  chatOpen,
  messages,
  toggleChat,
} from "./chat";
import type { ChatMessageEvent } from "@rollforge/protocol";

function event(seq: number, text: string): ChatMessageEvent {
  return {
    type: "ChatMessage",
    seq,
    id: `id-${seq}`,
    userId: "u",
    username: "u",
    role: "Player",
    kind: "chat",
    text,
    createdAt: 0,
  };
}

describe("chat state", () => {
  beforeEach(() => {
    messages.value = [];
    chatOpen.value = false;
    chatDraft.value = "";
  });

  it("appendMessage grows the list, preserving order", () => {
    appendMessage(event(1, "a"));
    appendMessage(event(2, "b"));
    expect(messages.value.map((m) => m.text)).toEqual(["a", "b"]);
  });

  it("replaceMessages swaps the list (used by chatHistory on connect)", () => {
    appendMessage(event(1, "stale"));
    replaceMessages([event(2, "fresh"), event(3, "newer")]);
    expect(messages.value.map((m) => m.text)).toEqual(["fresh", "newer"]);
  });

  it("toggleChat flips the open flag", () => {
    toggleChat();
    expect(chatOpen.value).toBe(true);
    toggleChat(false);
    expect(chatOpen.value).toBe(false);
  });
});
