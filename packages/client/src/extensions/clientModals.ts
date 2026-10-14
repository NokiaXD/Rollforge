import { signal } from "@preact/signals";
import type { ClientExtensionAPI, ClientModalRegistration } from "@rollforge/extension-api";

import { closeWindow, openWindow } from "../state/ui";

export interface OpenModal {
  id: string;
  //  Props are spread at render time, so the host keeps the registration loose.
  //  ponytail: `any` here is the price of one modal slot taking any component;
  //  drop it when a modal needs to be typed by its consumer.
  modal: ClientModalRegistration<any>;
  api: ClientExtensionAPI;
}

const modals = signal<readonly OpenModal[]>([]);

//  The window stack is the core's: ExtensionWindow reads windowFocusOrder for
//  z-index and cascades from nextCascadeStep, exactly like DocumentWindow.
const focusKey = (id: string) => `extmodal:${id}`;

/** One modal per id: re-opening an id already on screen replaces it, on top. */
export function openModal(entry: OpenModal): void {
  modals.value = [...modals.value.filter((m) => m.id !== entry.id), entry];
  openWindow(focusKey(entry.id));
}

export function closeModal(id: string): void {
  modals.value = modals.value.filter((m) => m.id !== id);
  closeWindow(focusKey(id));
}

export function openModals(): readonly OpenModal[] {
  return modals.value;
}

export function clearModals(): void {
  for (const m of modals.value) closeWindow(focusKey(m.id));
  modals.value = [];
}