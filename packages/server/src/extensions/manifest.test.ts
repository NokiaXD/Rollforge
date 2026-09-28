import { describe, it, expect } from "vitest";
import { validateManifest, CORE_VERSION } from "./manifest";

describe("validateManifest", () => {
  const baseValid = {
    id: "sample-ext",
    name: "Sample Extension",
    version: "1.0.0",
    engines: { core: "^0.1.0" },
    activationEvents: ["onCommand:foo"],
    contributes: {
      chatCommands: [{ name: "foo", description: "Foo command" }],
    },
  };

  it("validates a well-formed manifest with matching command activation", () => {
    const res = validateManifest(baseValid, CORE_VERSION);
    expect(res.ok).toBe(true);
    expect(res.effectiveEvents).toContain("onCommand:foo");
  });

  it("rejects non-object or null manifests", () => {
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest("string").ok).toBe(false);
  });

  it("requires kebab-case id", () => {
    expect(validateManifest({ ...baseValid, id: "Invalid_ID" }).ok).toBe(false);
    expect(validateManifest({ ...baseValid, id: "invalid ID" }).ok).toBe(false);
    expect(validateManifest({ ...baseValid, id: "valid-kebab-123" }).ok).toBe(true);
  });

  it("validates semver version", () => {
    expect(validateManifest({ ...baseValid, version: "not-semver" }).ok).toBe(false);
  });

  it("checks semver satisfaction against coreVersion for third-party extensions", () => {
    const incompatible = { ...baseValid, engines: { core: ">=2.0.0" } };
    const res = validateManifest(incompatible, "0.1.0");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("incompatible");
  });

  it("exempts builtin extensions from engines.core satisfaction", () => {
    const builtinExt = {
      ...baseValid,
      id: "builtin-dice",
      builtin: true,
      engines: { core: ">=99.0.0" },
    };
    const res = validateManifest(builtinExt, "0.1.0");
    expect(res.ok).toBe(true);
  });

  it("forbids wildcard '*' in activationEvents", () => {
    const wildcard = { ...baseValid, activationEvents: ["*"] };
    const res = validateManifest(wildcard);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Wildcard '*' in activationEvents is forbidden");
  });

  it("rejects activationEvents with onCommand that is not declared in contributes", () => {
    const undeclared = {
      ...baseValid,
      activationEvents: ["onCommand:unknown"],
    };
    const res = validateManifest(undeclared);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("references command \"unknown\" not found in contributes.chatCommands");
  });

  it("derives onCommand:<x> automatically from contributes.chatCommands", () => {
    const autoDerived = {
      id: "auto-cmd",
      name: "Auto Command",
      version: "1.0.0",
      engines: { core: "^0.1.0" },
      activationEvents: [] as string[],
      contributes: {
        chatCommands: [{ name: "bar", description: "Bar command" }],
      },
    };
    const res = validateManifest(autoDerived);
    expect(res.ok).toBe(true);
    expect(res.effectiveEvents).toEqual(["onCommand:bar"]);
  });

  it("rejects manifests with empty effective activationEvents", () => {
    const emptyEvents = {
      id: "empty-events",
      name: "Empty Events",
      version: "1.0.0",
      engines: { core: "^0.1.0" },
      activationEvents: [] as string[],
    };
    const res = validateManifest(emptyEvents);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("empty effective activationEvents");
  });
});
