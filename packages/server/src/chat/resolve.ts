import type { RollActorRef } from "@rollforge/protocol";

// only one of these kinds survives resolve. The handler turns each into a
// socket emit. Roll resolution defers dice execution so actor validation can reject
// without burning cycles.
export type ChatResolution =
  | { kind: "chat"; text: string }
  | {
      kind: "whisper";
      text: string;
      recipientUsername: string;
    }
  | {
      kind: "roll";
      text: string;
      notation: string;
      actor: RollActorRef;
    }
  | { kind: "reject"; reason: "empty" | "too-long" | "not-a-command"; text: string };

export interface ResolveLimits {
  maxLen: number;
}

export interface ResolveCtx {
  limits: ResolveLimits;
}

const ROLL_RE = /^\s*\/roll\s+(\S+)\s*$/i;
const W_RE = /^\s*\/w(?:hisper)?\s+(\S+)\s+(.+)$/i;

export function resolveChatMessage(rawText: string, ctx: ResolveCtx): ChatResolution {
  const text = rawText.trim();
  if (!text) return { kind: "reject", reason: "empty", text: "" };
  if (text.length > ctx.limits.maxLen) {
    return { kind: "reject", reason: "too-long", text: text.slice(0, ctx.limits.maxLen) };
  }

  const w = W_RE.exec(text);
  if (w) {
    const recipientUsername = w[1] ?? "";
    const body = (w[2] ?? "").trim();
    if (!recipientUsername || !body) {
      return { kind: "reject", reason: "not-a-command", text };
    }
    return { kind: "whisper", text: body, recipientUsername };
  }

  const r = ROLL_RE.exec(text);
  if (r) {
    const notation = r[1] ?? "";
    if (!notation) return { kind: "reject", reason: "not-a-command", text };
    return { kind: "roll", text, notation, actor: { type: "user" } };
  }

  if (text.startsWith("/")) return { kind: "reject", reason: "not-a-command", text };

  return { kind: "chat", text };
}

// split out so callers can route commands without going through the
// resolution wrapper. Used by the handler when it already knows the intent is a command.
export function classifyCommand(text: string):
  | { command: "roll"; notation: string }
  | { command: "whisper"; recipient: string; body: string }
  | { command: "chat"; text: string }
  | { command: "unknown" } {
  const trimmed = text.trim();
  if (!trimmed) return { command: "unknown" };
  const rollMatch = /^\/roll\s+(\S+)\s*$/i.exec(trimmed);
  if (rollMatch) return { command: "roll", notation: rollMatch[1] ?? "" };
  const wMatch = /^\/w(?:hisper)?\s+(\S+)\s+(.+)$/i.exec(trimmed);
  if (wMatch) return { command: "whisper", recipient: wMatch[1] ?? "", body: (wMatch[2] ?? "").trim() };
  if (trimmed.startsWith("/")) return { command: "unknown" };
  return { command: "chat", text: trimmed };
}

export function defaultActor(): RollActorRef {
  return { type: "user" };
}
