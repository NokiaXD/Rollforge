import type { IntentRejectReason } from "@rollforge/protocol";

export class CommandRejection extends Error {
  public readonly reason: IntentRejectReason | string;

  constructor(reason: IntentRejectReason | string) {
    super(reason);
    this.name = "CommandRejection";
    this.reason = reason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

//  Paso 16 — typed rejection for client-side document writes. The
// bootstrap translates server HTTP error codes (403/404/409/503/network)
// into this one class so sheets can branch on `.reason` without inspecting
// raw HTTP envelopes. Mirrors the style of CommandRejection / SheetOwnerConflict.
export type DocumentUpdateRejectionReason =
  | "forbidden"
  | "extension-not-ready"
  | "migration-blocked"
  | "stale-rev"
  | "not-found"
  | "network-error";

export class DocumentUpdateRejection extends Error {
  public readonly reason: DocumentUpdateRejectionReason;
  //  small structured payload from the server (e.g. `{ id }` on
  // migration-blocked, `{ type }` on extension-not-ready). Empty by default.
  public readonly meta: Record<string, unknown>;

  constructor(reason: DocumentUpdateRejectionReason, meta?: Record<string, unknown>) {
    super(reason);
    this.name = "DocumentUpdateRejection";
    this.reason = reason;
    this.meta = meta ?? {};
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export const errors = {
  CommandRejection,
  DocumentUpdateRejection,
};
