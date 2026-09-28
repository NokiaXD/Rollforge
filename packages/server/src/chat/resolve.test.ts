import { describe, it, expect } from "vitest";
import { resolveChatMessage, type ResolveCtx } from "./resolve";

const ctx: ResolveCtx = { limits: { maxLen: 2000 } };

describe("resolveChatMessage", () => {
  it("returns empty for blank text", () => {
    expect(resolveChatMessage("", ctx)).toEqual({ kind: "reject", reason: "empty" });
    expect(resolveChatMessage("   ", ctx)).toEqual({ kind: "reject", reason: "empty" });
  });

  it("rejects messages exceeding the limit", () => {
    const big = "x".repeat(2001);
    const out = resolveChatMessage(big, ctx);
    expect(out).toEqual({ kind: "reject", reason: "too-long" });
  });

  it("classifies plain text as chat", () => {
    expect(resolveChatMessage("hello", ctx)).toEqual({
      command: "",
      args: ["hello"],
      rest: "hello",
    });
    expect(resolveChatMessage("hello world from rollforge", ctx)).toEqual({
      command: "",
      args: ["hello", "world", "from", "rollforge"],
      rest: "hello world from rollforge",
    });
  });

  it("parses /roll <notation>", () => {
    expect(resolveChatMessage("/roll 1d20", ctx)).toEqual({
      command: "roll",
      args: ["1d20"],
      rest: "1d20",
    });
    expect(resolveChatMessage("/ROLL 2d6+3", ctx)).toEqual({
      command: "roll",
      args: ["2d6+3"],
      rest: "2d6+3",
    });
  });

  it("parses /roll with no arguments", () => {
    expect(resolveChatMessage("/roll", ctx)).toEqual({
      command: "roll",
      args: [],
      rest: "",
    });
    expect(resolveChatMessage("/roll ", ctx)).toEqual({
      command: "roll",
      args: [],
      rest: "",
    });
  });

  it("parses /w <user> <message>", () => {
    expect(resolveChatMessage("/w bob secret message", ctx)).toEqual({
      command: "w",
      args: ["bob", "secret", "message"],
      rest: "bob secret message",
    });
  });

  it("parses /w preserving whitespace in rest", () => {
    expect(resolveChatMessage("/w bob   lots   of   spaces", ctx)).toEqual({
      command: "w",
      args: ["bob", "lots", "of", "spaces"],
      rest: "bob   lots   of   spaces",
    });
  });

  it("parses /whisper alias as independent command", () => {
    expect(resolveChatMessage("/whisper alice hi", ctx)).toEqual({
      command: "whisper",
      args: ["alice", "hi"],
      rest: "alice hi",
    });
  });

  it("parses unknown slash commands generically", () => {
    expect(resolveChatMessage("/foo bar baz", ctx)).toEqual({
      command: "foo",
      args: ["bar", "baz"],
      rest: "bar baz",
    });
  });
});
