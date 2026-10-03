import { DocumentUpdateRejection, freezeClientAPI, type ClientExtensionAPI } from "@rollforge/extension-api";
import { effect } from "@preact/signals";
import type { Document } from "@rollforge/protocol";
import { registerSheet, setOwnerMap } from "./clientSheets";
import { CustomActorSheet } from "./builtins/customActorSheet";
import { documents, upsertDocument } from "../state/documents";
import { myUserId, currentSceneId } from "../state/scene";
import { httpPatchDocument } from "./documentTransport";
import { fetchDocumentTypes } from "../state/extensionSources";
import { fetchMe } from "../state/auth";
import { loadClientExtensions } from "./extensionLoader";

//  the client-side "extension host" seed. Builds the frozen ClientExtensionAPI
// from the host's transport (signal store + httpPatchDocument), then hands it
// to the bootstrap sheet or dynamically loaded client extensions.
export function buildClientAPI(extensionId: string = "client-extension"): ClientExtensionAPI {
  return freezeClientAPI({
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
      notify: (msg) => {
        // console fallback; the real toast system lives elsewhere.
        console.info("[extension-api]", msg);
      },
    },
    context: {
      userId: myUserId.value ?? "",
      sceneId: currentSceneId.value,
    },
  });
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

export async function bootstrapClient(): Promise<void> {
  await waitForApi();
  await fetchMe();
  const types = await fetchDocumentTypes();
  const map: Record<string, string | undefined> = {};
  for (const t of types) map[t.id] = t.extensionId;
  setOwnerMap(map);
  await loadClientExtensions((id) => buildClientAPI(id));
}

export { api };