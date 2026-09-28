import type { SceneEvent, Intent } from "./documents";

export interface SocketEnvelope<T> {
  v: 1;
  data: T;
}

export type IntentMessage = SocketEnvelope<Intent>;
export type EventMessage = SocketEnvelope<SceneEvent>;

export type IntentRejectReason =
  | "forbidden"
  | "rate-limit"
  | "not-a-command"
  | "not-found"
  | "bad-notation"
  | "dice-count-too-large"
  | "invalid-keep"
  | "face-too-large"
  | "too-many-terms"
  | "stale-or-locked"
  | "locked"
  | "not-in-active-scene"
  | "invalid"
  | "conflict"
  | "command-failed"
  | "extension-unavailable";

export interface IntentRejectedMessage {
  intent: Intent;
  reason: IntentRejectReason | (string & {});
}