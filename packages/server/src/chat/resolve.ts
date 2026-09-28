export type ChatResolution =
  | { command: string; args: string[]; rest: string }
  | { kind: "reject"; reason: "empty" | "too-long"; text?: string };

export interface ResolveLimits {
  maxLen: number;
}

export interface ResolveCtx {
  limits: ResolveLimits;
}

export function resolveChatMessage(rawText: string, ctx: ResolveCtx): ChatResolution {
  const text = rawText.trim();
  if (!text) return { kind: "reject", reason: "empty" };
  if (text.length > ctx.limits.maxLen) {
    return { kind: "reject", reason: "too-long" };
  }

  if (text.startsWith("/")) {
    const afterSlash = text.slice(1);
    const firstSpaceIndex = afterSlash.search(/\s/);
    if (firstSpaceIndex === -1) {
      const command = afterSlash.toLowerCase();
      return { command, args: [], rest: "" };
    }

    const command = afterSlash.slice(0, firstSpaceIndex).toLowerCase();
    const rest = afterSlash.slice(firstSpaceIndex + 1);
    const args = rest.split(/\s+/).filter(Boolean);
    return { command, args, rest };
  }

  return {
    command: "",
    args: text.split(/\s+/).filter(Boolean),
    rest: text,
  };
}
