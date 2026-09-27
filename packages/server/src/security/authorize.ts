import type { Document, OwnershipLevel } from "@rollforge/protocol";

export type ActionType = "MoveToken" | "AcquireDragLock" | "ReleaseDragLock" | "CreateToken";

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