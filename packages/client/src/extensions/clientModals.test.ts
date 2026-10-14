import { describe, expect, it, beforeEach } from "vitest";
import type { ClientExtensionAPI, ClientModalRegistration } from "@rollforge/extension-api";

import { clearModals, closeModal, openModal, openModals } from "./clientModals";

const api = {} as ClientExtensionAPI;
const modal = (title: string): ClientModalRegistration<any> => ({ id: "m", title, component: () => null });

beforeEach(() => clearModals());

describe("clientModals", () => {
  it("opens, replaces by id and closes", () => {
    openModal({ id: "a", modal: modal("one"), api });
    openModal({ id: "b", modal: modal("two"), api });
    expect(openModals().map((m) => m.id)).toEqual(["a", "b"]);

    // Same id replaces instead of stacking, and lands on top (focus order).
    openModal({ id: "a", modal: modal("one again"), api });
    expect(openModals().map((m) => m.id)).toEqual(["b", "a"]);
    expect(openModals().at(-1)!.modal.title).toBe("one again");

    closeModal("a");
    expect(openModals().map((m) => m.id)).toEqual(["b"]);
    closeModal("missing");
    expect(openModals().map((m) => m.id)).toEqual(["b"]);
  });
});