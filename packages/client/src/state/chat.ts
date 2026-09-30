import { signal } from "@preact/signals";
import type { ChatMessageEvent } from "@rollforge/protocol";

// messages are the rendered list. chatOpen is the panel toggle and
// chatDraft holds the in-progress input so refreshes don't lose pending text.
export const messages = signal<ChatMessageEvent[]>([]);
export const chatOpen = signal<boolean>(true);
export const chatDraft = signal<string>("");

export function appendMessage(m: ChatMessageEvent): void {
  messages.value = [...messages.value, m];
}

export function replaceMessages(history: ChatMessageEvent[]): void {
  messages.value = [...history];
}

export function toggleChat(force?: boolean): void {
  chatOpen.value = force ?? !chatOpen.value;
}
