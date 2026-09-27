import type { SceneEvent, Intent } from "./documents";

export interface SocketEnvelope<T> {
  v: 1;
  data: T;
}

export type IntentMessage = SocketEnvelope<Intent>;
export type EventMessage = SocketEnvelope<SceneEvent>;