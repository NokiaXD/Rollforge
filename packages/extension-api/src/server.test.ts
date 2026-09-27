import { describe, it, expect } from "vitest";
import { freezeServerAPI, type ServerExtensionAPI } from "./server";

describe("server API freeze", () => {
  it("freezes the api object so internals cannot be mutated", () => {
    const api: ServerExtensionAPI = {
      documents: {} as ServerExtensionAPI["documents"],
      hooks: {} as ServerExtensionAPI["hooks"],
      chat: {} as ServerExtensionAPI["chat"],
      dice: {} as ServerExtensionAPI["dice"],
      context: { userId: "u1", isGM: false },
    };
    const frozen = freezeServerAPI(api);
    expect(Object.isFrozen(frozen)).toBe(true);
  });
});