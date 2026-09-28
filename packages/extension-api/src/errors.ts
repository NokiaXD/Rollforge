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

export const errors = {
  CommandRejection,
};
