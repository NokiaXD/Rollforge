import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "./jwt";

const SECRET = "x".repeat(48);

describe("jwt", () => {
  it("signs and verifies a session payload", () => {
    const token = signSession(SECRET, { sub: "alice", role: "GM" });
    const decoded = verifySession(SECRET, token);
    expect(decoded).toEqual({ sub: "alice", role: "GM" });
  });

  it("returns null on bad signature", () => {
    const token = signSession(SECRET, { sub: "alice", role: "Player" });
    expect(verifySession(SECRET + "x", token)).toBeNull();
  });

  it("returns null on malformed token", () => {
    expect(verifySession(SECRET, "not.a.token")).toBeNull();
  });
});