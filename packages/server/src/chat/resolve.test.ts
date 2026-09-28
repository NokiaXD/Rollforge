import { describe, it, expect } from "vitest";
import { resolveChatMessage, classifyCommand, type ResolveCtx } from "./resolve";

const ctx: ResolveCtx = { limits: { maxLen: 2000 } };

describe("resolveChatMessage", () => {
  it("returns empty for blank text", () => {
    expect(resolveChatMessage("", ctx)).toEqual({ kind: "reject", reason: "empty", text: "" });
    expect(resolveChatMessage("   ", ctx)).toEqual({ kind: "reject", reason: "empty", text: "" });
  });

  it("rejects messages exceeding the limit", () => {
    const big = "x".repeat(2001);
    const out = resolveChatMessage(big, ctx);
    expect(out.kind).toBe("reject");
    if (out.kind === "reject") expect(out.reason).toBe("too-long");
  });

  it("classifies plain text as chat", () => {
    expect(resolveChatMessage("hello", ctx)).toEqual({ kind: "chat", text: "hello" });
  });

  it("classifies /roll <notation> with actor fallback to user", () => {
    const out = resolveChatMessage("/roll 1d20", ctx);
    expect(out.kind).toBe("roll");
    if (out.kind === "roll") {
      expect(out.notation).toBe("1d20");
      expect(out.actor).toEqual({ type: "user" });
    }
  });

  it("rejects /roll with no notation", () => {
    expect(resolveChatMessage("/roll", ctx).kind).toBe("reject");
    expect(resolveChatMessage("/roll ", ctx).kind).toBe("reject");
  });

  it("classifies /w <user> ... as whisper", () => {
    const out = resolveChatMessage("/w bob secret message", ctx);
    expect(out).toEqual({
      kind: "whisper",
      text: "secret message",
      recipientUsername: "bob",
    });
  });

  it("rejects /w without a body", () => {
    expect(resolveChatMessage("/w bob", ctx).kind).toBe("reject");
  });

  it("rejects unknown slash commands", () => {
    expect(resolveChatMessage("/foo", ctx)).toEqual({
      kind: "reject",
      reason: "not-a-command",
      text: "/foo",
    });
  });

  it("accepts /whisper alias", () => {
    const out = resolveChatMessage("/whisper alice hi", ctx);
    expect(out.kind).toBe("whisper");
    if (out.kind === "whisper") {
      expect(out.recipientUsername).toBe("alice");
      expect(out.text).toBe("hi");
    }
  });
});

describe("classifyCommand", () => {
  it("rolls", () => {
    expect(classifyCommand("/roll 2d20kh1+5")).toEqual({
      command: "roll",
      notation: "2d20kh1+5",
    });
  });

  it("whispers", () => {
    expect(classifyCommand("/w alice meet me")).toEqual({
      command: "whisper",
      recipient: "alice",
      body: "meet me",
    });
  });

  it("plain chat", () => {
    expect(classifyCommand("hi")).toEqual({ command: "chat", text: "hi" });
  });

  it("unknown on unknown slash", () => {
    expect(classifyCommand("/yolo")).toEqual({ command: "unknown" });
    expect(classifyCommand("")).toEqual({ command: "unknown" });
  });
});
