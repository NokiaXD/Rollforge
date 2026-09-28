import type { Document, OwnershipLevel } from "@rollforge/protocol";

export type ActionType = "MoveToken" | "AcquireDragLock" | "ReleaseDragLock" | "CreateToken";

// Actions that don't bind to a Document — chat sends, future broadcasts.
// Kept narrow so future GM-only chat commands slot in with a typo-resistant check.
export type NonDocActionType = "SendChatMessage" | "SendWhisper";

const RANK: Record<OwnershipLevel, number> = {
  NONE: 0,
  OBSERVER: 1,
  LIMITED: 2,
  OWNER: 3,
};

const REQUIRED: Record<ActionType, OwnershipLevel> = {
  MoveToken: "LIMITED",
  AcquireDragLock: "LIMITED",
  ReleaseDragLock: "LIMITED",
  CreateToken: "LIMITED",
};

export function levelSatisfies(actual: OwnershipLevel, required: OwnershipLevel): boolean {
  return RANK[actual] >= RANK[required];
}

export function requiredLevelFor(action: ActionType): OwnershipLevel {
  return REQUIRED[action];
}

export function authorize(
  userId: string,
  action: ActionType,
  doc: Document<unknown>,
  isGM: boolean,
): boolean {
  if (isGM) return true;
  const level = doc.ownership[userId] ?? doc.ownership.default ?? "NONE";
  return levelSatisfies(level, requiredLevelFor(action));
}

// any authenticated user can chat. Future system hooks (Paso 12) tighten this.
// Returning true unconditionally today keeps the handler routing single-code-path.
export function authorizeAction(_userId: string, _action: NonDocActionType, isGM: boolean): boolean {
  if (isGM) return true;
  return true;
}

// Returns true when `userId` is allowed to roll on behalf of the given character.
// Today: GM always yes; otherwise the user must hold OWNER (or default=OWNER) on the doc.
// Tighten in a later Paso once per-system ownership rules exist.
export function canRollAsCharacter(userId: string, characterDoc: Document<unknown> | null, isGM: boolean): boolean {
  if (isGM) return true;
  if (!characterDoc) return false;
  const level: OwnershipLevel = characterDoc.ownership[userId] ?? characterDoc.ownership.default ?? "NONE";
  return levelSatisfies(level, "OWNER");
}
