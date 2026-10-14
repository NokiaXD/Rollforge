import { DocumentUpdateRejection, freezeClientAPI, type ClientExtensionAPI, type ClientPanelRegistration, type ClientViewportLike } from "@rollforge/extension-api";
import { effect } from "@preact/signals";
import { Fragment, h } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Container, Graphics, Text } from "pixi.js";
import type { Viewport } from "pixi-viewport";
import type { Document } from "@rollforge/protocol";
import { registerSheet, setOwnerMap } from "./clientSheets";
import { registerPanel, registerCorePanel } from "./clientPanels";
import { openModal as hostOpenModal, closeModal as hostCloseModal } from "./clientModals";
import { CustomActorSheet } from "./builtins/customActorSheet";
import { ImagePicker } from "../ui/ImagePicker";
import { ScenesView } from "../ui/views/ScenesView";
import { TokensView } from "../ui/views/TokensView";
import { ChatView } from "../ui/views/ChatView";
import { documents, listDocumentsByType, upsertDocument } from "../state/documents";
import { myUserId, currentSceneId, cellSize, tokens } from "../state/scene";
import { viewedScene } from "../state/scenes";
import { getViewport, onViewportReady } from "../canvas/currentViewport";
import { httpPatchDocument, httpPostDocument } from "./documentTransport";
import { fetchDocumentTypes } from "../state/extensionSources";
import { currentUser, fetchMe, authStatus } from "../state/auth";
import { openContextMenu, openDocument } from "../state/ui";
import { loadClientExtensions } from "./extensionLoader";
import { addToast } from "../state/toasts";

//  the client-side "extension host" seed. Builds the frozen ClientExtensionAPI
// from the host's transport (signal store + httpPatchDocument), then hands it
// to the bootstrap sheet or dynamically loaded client extensions.
export function buildClientAPI(extensionId: string = "client-extension"): ClientExtensionAPI {
  const api: ClientExtensionAPI = {
    documents: {
      get: <T extends Document = Document>(id: string): T | null => {
        return (documents.value.get(id) as T | undefined) ?? null;
      },
      subscribe: <T extends Document = Document>(
        id: string,
        fn: (doc: T) => void,
      ): (() => void) => {
        let last: T | null = null;
        // closure over `documents` signal via @preact/signals
        // `effect`. Effect dedupes by identity before calling `fn`, and
        // returns its own dispose for unmount cleanup.
        return effect(() => {
          const doc = (documents.value.get(id) as T | undefined) ?? null;
          if (doc === last) return;
          last = doc;
          if (doc) fn(doc);
        });
      },
      update: async <T extends Document = Document>(
        id: string,
        patch: Partial<T>,
      ): Promise<T> => {
        const { body } = await httpPatchDocument(id, patch as Record<string, unknown>);
        if (body && typeof body === "object") upsertDocument(body as Document);
        const next = documents.value.get(id);
        if (!next) throw new DocumentUpdateRejection("not-found");
        return next as T;
      },
      list: <T extends Document = Document>(type: string): readonly T[] =>
        listDocumentsByType(type) as unknown as readonly T[],
      create: async <T extends Document = Document>(
        input: Omit<T, "_rev" | "schemaVersion">,
      ): Promise<T> => {
        // `schemaVersion` is stripped here as well as by the server: the
        // typed input does not carry it, but a JS extension can still pass it,
        // and the host is the only thing that may name a version.
        const { schemaVersion: _ignored, ...fields } = input as Record<string, unknown>;
        const { body } = await httpPostDocument(fields);
        const doc = (body ?? null) as Document | null;
        if (!doc || typeof doc.id !== "string") throw new DocumentUpdateRejection("network-error");
        upsertDocument(doc);
        return doc as T;
      },
    },
    hooks: {
      // client-side hook surface is intentionally empty — no client
      // hook engine exists yet. Sheets that try to hook get a silent no-op
      // rather than a thrown frozen-stub.
      on: () => {},
      filter: () => {},
      off: () => {},
    },
    ui: {
      registerSheet: (opts) => {
        // host-side closure registers the sheet against the
        // internal clientSheets store. Real client extensions in Fase 2 will
        // call this with their own captured `api`.
        const entry: Parameters<typeof registerSheet>[0] = {
          documentType: opts.documentType,
          component: opts.component as never,
          extensionId,
        };
        if (opts.default !== undefined) entry.default = opts.default;
        registerSheet(entry);
      },
      registerPanel: (opts) => {
        // Paso 18: forward to the internal panel registry. registerPanel
        // prefetches the declared documentTypes, so a panel's data is in the
        // signal store by the time the tab is opened.
        registerPanel({
          panel: opts as ClientPanelRegistration,
          api,
          extensionId,
        });
      },
      notify: (msg) => {
        addToast({ text: msg, kind: "info" });
      },
      //  Paso 25: the same signal the core Actores view writes, so an extension
      //  list can hand a row off to the registered sheet. SheetModal reads it
      //  and fetches the document itself if the store does not have it.
      openDocument: (id: string) => {
        openDocument(id);
      },
      //  Floating window in the host's WindowFrame shell; ExtensionModal owns it.
      openModal: (opts) => {
        hostOpenModal({ id: opts.id, modal: opts, api });
      },
      closeModal: (id: string) => {
        hostCloseModal(id);
      },
      //  Shared by every extension: read a File into a token-shaped data URL.
      //  Bound here because the picker opens the cropper through the host's
      //  modal registry, which needs the api of the extension asking for it.
      imagePicker: (props) => <ImagePicker {...props} api={api} />,
      //  The core's ContextMenu, same renderer the Actores view uses. The item
      //  shape is ClientContextMenuItem, a copy of the core's, so it needs no
      //  adapter here.
      openContextMenu: (pos, items) => {
        openContextMenu({ clientX: pos.x, clientY: pos.y }, [...items]);
      },
      //  The host's preact, so a raw-served extension file never has to import
      //  it (see ClientPreactAPI: the import map gives it a second instance).
      preact: { h, Fragment, useState, useRef, useEffect, useMemo, useCallback },
    },
    context: {
      userId: myUserId.value ?? "",
      sceneId: currentSceneId.value,
      //  Snapshot, like userId/sceneId above: a getter would be fresher but
      //  deepFreeze skips accessors, and this object is built per extension
      //  AFTER fetchMe() (loadExtensionHost runs under the authenticated
      //  branch), so the role is already settled.
      role: currentUser.value?.role ?? null,
    },
    //  Paso 24: the drawing surface. A getter, because extensions activate
    //  before ui/App.tsx creates Pixi — a captured value would be forever null.
    //  deepFreeze skips accessors, so the Viewport is never frozen.
    canvas: {
      get viewport() {
        return getViewport() as ClientViewportLike | null;
      },
      //  The classes are handed over, not imported by the extension: a raw-served
      //  client file can only resolve what index.html's import map covers, and
      //  that map only exists under the Vite dev server.
      pixi: { Container, Graphics, Text },
      onReady: (cb) => {
        onViewportReady(cb as (vp: Viewport) => void);
      },
    },
    scene: {
      cellSize: () => cellSize.value,
      //  SceneSystem keeps these optional (base type, no migration chain), so
      //  the fallback lives here — the single read point.
      cellLength: () => viewedScene.value?.system.cellLength ?? 5,
      units: () => viewedScene.value?.system.units ?? "ft",
      tokens: () =>
        [...tokens.value.values()].map((t) => ({
          id: t.id,
          x: t.x,
          y: t.y,
          w: t.w,
          h: t.h,
        })),
    },
  };
  return freezeClientAPI(api);
}

//  Static core registrations. BASE_TYPE_OWNERS pre-seeds Actor/Item/Scene
// ownership in clientSheets, so these calls succeed even before the server's
// /api/document-types response lands — the order no longer matters.
registerSheet({
  documentType: "Actor",
  component: ({ documentId }) => <CustomActorSheet documentId={documentId} api={api} />,
  default: true,
  extensionId: "core:custom-actor-sheet",
});

const api = buildClientAPI();

registerCorePanel({
  panel: {
    id: "scenes",
    title: "Gestor de Escenas",
    icon: "nf-cod-map",
    requiresGm: true,
    component: () => <ScenesView />,
  },
  api,
  extensionId: "core",
});

registerCorePanel({
  panel: {
    id: "tokens",
    title: "Tokens en Escena",
    icon: "nf-fa-user_group",
    component: () => <TokensView />,
  },
  api,
  extensionId: "core",
});

registerCorePanel({
  panel: {
    id: "chat",
    title: "Chat & Dados",
    icon: "nf-fa-comments",
    component: () => <ChatView />,
  },
  api,
  extensionId: "core",
});

//  fetchDocumentTypes → setOwnerMap → loadClientExtensions bridges the
// server's declarative registries into the client. Failure is non-fatal: an
// anon / network blip leaves BASE_TYPE_OWNERS intact and lets the core Actor
// sheet still mount.

// Every fetch in the bootstrap swallows network errors and degrades to "empty",
// so a client that boots before the API is listening stays permanently
// degraded: no owner map and no client extension sheets. Probe /api/auth/me
// until the API answers (any HTTP status, including 401 — a throw means the
// connection is still refused) and only then run the sequence.
// ponytail: fixed 250ms x 60 budget instead of a health endpoint or an
// event-driven signal; a long-lived client needs no retry at all.
export async function waitForApi(
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<boolean> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await fetchImpl("/api/auth/me", { credentials: "include" });
      return true;
    } catch {
      await sleep(250);
    }
  }
  return false;
}

let extensionHost: Promise<void> | null = null;

function loadExtensionHost(): Promise<void> {
  extensionHost ??= (async () => {
    const types = await fetchDocumentTypes();
    const map: Record<string, string | undefined> = {};
    for (const t of types) map[t.id] = t.extensionId;
    setOwnerMap(map);
    await loadClientExtensions((id) => buildClientAPI(id));
  })();
  return extensionHost;
}

export async function bootstrapClient(): Promise<void> {
  await waitForApi();
  await fetchMe();
  // /api/document-types and /api/extension-sources are behind requireAuth, so
  // a client that boots anon gets 401s and registers no extension ever — not
  // until a page reload with the new cookie. Watch authStatus instead: the
  // effect runs immediately when the session cookie already authenticated us,
  // and again the moment the login form flips the status.
  effect(() => {
    if (authStatus.value === "authenticated") void loadExtensionHost();
  });
  if (authStatus.value === "authenticated") await loadExtensionHost();
}

export { api };