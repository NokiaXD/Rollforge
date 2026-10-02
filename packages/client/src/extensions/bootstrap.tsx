import { DocumentUpdateRejection, freezeClientAPI, type ClientExtensionAPI } from "@rollforge/extension-api";
import { effect } from "@preact/signals";
import type { Document } from "@rollforge/protocol";
import { registerSheet } from "./clientSheets";
import { CustomActorSheet } from "./builtins/customActorSheet";
import { documents, upsertDocument } from "../state/documents";
import { myUserId, currentSceneId } from "../state/scene";
import { httpPatchDocument } from "./documentTransport";

//  the client-side "extension host" seed. Builds the frozen ClientExtensionAPI
// from the host's transport (signal store + httpPatchDocument), then hands it
// to the bootstrap sheet. When we add a real client-side extension loader,
// disk extensions will register sheets via `api.ui.registerSheet` with their
// own captured `api`.
function buildClientAPI(): ClientExtensionAPI {
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
        // ponytail: closure over `documents` signal via @preact/signals
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
      // ponytail: client-side hook surface is intentionally empty — no client
      // hook engine exists yet. Sheets that try to hook get a silent no-op
      // rather than a thrown frozen-stub.
      on: () => {},
      filter: () => {},
      off: () => {},
    },
    ui: {
      registerSheet: (opts) => {
        // ponytail: host-side closure registers the sheet against the
        // internal clientSheets store. Real client extensions in Fase 2 will
        // call this with their own captured `api`.
        const entry: Parameters<typeof registerSheet>[0] = {
          documentType: opts.documentType,
          component: opts.component as never,
          extensionId: "client-extension",
        };
        if (opts.default !== undefined) entry.default = opts.default;
        registerSheet(entry);
      },
      notify: (msg) => {
        // ponytail: console fallback; the real toast system lives elsewhere.
        console.info("[extension-api]", msg);
      },
    },
    context: {
      userId: myUserId.value ?? "",
      sceneId: currentSceneId.value,
    },
  });
}

const api = buildClientAPI();

//  bootstrap registers the default Actor sheet directly via the host's
// clientSheets (we have the api in hand, no need to round-trip through the
// frozen surface).
registerSheet({
  documentType: "Actor",
  component: ({ documentId }) => <CustomActorSheet documentId={documentId} api={api} />,
  default: true,
  extensionId: "core:custom-actor-sheet",
});

export { api };
