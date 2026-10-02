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

  describe("contributes.documentTypes and contributes.sheets (Paso 13)", () => {
    const withDocTypes = {
      id: "sheets-ext",
      name: "Sheets",
      version: "1.0.0",
      engines: { core: "^0.1.0" },
      activationEvents: ["onReady"],
      contributes: {
        documentTypes: [
          { id: "cpr-character", base: "Actor", schemaVersion: 1 },
        ],
        sheets: [
          { documentType: "cpr-character", component: "CprSheet", default: true },
        ],
      },
    };

    it("accepts a valid manifest with documentTypes + sheets", () => {
      const res = validateManifest(withDocTypes, CORE_VERSION);
      expect(res.ok).toBe(true);
    });

    it("rejects non-kebab documentType id", () => {
      const bad = {
        ...withDocTypes,
        contributes: {
          documentTypes: [{ id: "BadId", base: "Actor", schemaVersion: 0 }],
        },
      };
      const res = validateManifest(bad);
      expect(res.ok).toBe(false);
      expect(res.error).toContain('Invalid documentType id "BadId"');
    });

    it("rejects documentType with invalid base", () => {
      const bad = {
        ...withDocTypes,
        contributes: {
          documentTypes: [{ id: "ok-id", base: "Whatever", schemaVersion: 0 }],
        },
      };
      const res = validateManifest(bad);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("Actor/Item/Scene");
    });

    it("rejects non-integer or negative schemaVersion", () => {
      const nonInt = {
        ...withDocTypes,
        contributes: {
          documentTypes: [{ id: "ok-id", base: "Actor", schemaVersion: 1.5 }],
        },
      };
      expect(validateManifest(nonInt).ok).toBe(false);

      const negative = {
        ...withDocTypes,
        contributes: {
          documentTypes: [{ id: "ok-id", base: "Actor", schemaVersion: -1 }],
        },
      };
      expect(validateManifest(negative).ok).toBe(false);
    });

    it("rejects duplicate documentType id within the manifest", () => {
      const dup = {
        ...withDocTypes,
        contributes: {
          documentTypes: [
            { id: "dup", base: "Actor", schemaVersion: 0 },
            { id: "dup", base: "Item", schemaVersion: 0 },
          ],
        },
      };
      const res = validateManifest(dup);
      expect(res.ok).toBe(false);
      expect(res.error).toContain('documentType id "dup" appears more than once');
    });

    it("rejects sheet that references a non-contributed, non-base documentType", () => {
      const orphanSheet = {
        ...withDocTypes,
        contributes: {
          documentTypes: [{ id: "real", base: "Actor", schemaVersion: 0 }],
          sheets: [{ documentType: "ghost", component: "X", default: true }],
        },
      };
      const res = validateManifest(orphanSheet);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("must reference either a contributed id");
    });

    it("accepts sheet referencing a base type (Actor/Item/Scene)", () => {
      const baseSheet = {
        ...withDocTypes,
        contributes: {
          documentTypes: [{ id: "cpr-character", base: "Actor", schemaVersion: 0 }],
          sheets: [{ documentType: "Actor", component: "ActorSheetX", default: true }],
        },
      };
      const res = validateManifest(baseSheet, CORE_VERSION);
      expect(res.ok).toBe(true);
    });

    it("rejects multiple default:true sheets for the same documentType within one manifest", () => {
      const twoDefaults = {
        ...withDocTypes,
        contributes: {
          documentTypes: [{ id: "cpr-character", base: "Actor", schemaVersion: 0 }],
          sheets: [
            { documentType: "cpr-character", component: "A", default: true },
            { documentType: "cpr-character", component: "B", default: true },
          ],
        },
      };
      const res = validateManifest(twoDefaults);
      expect(res.ok).toBe(false);
      expect(res.error).toContain('Multiple sheets in manifest marked default: true');
    });
  });
});
