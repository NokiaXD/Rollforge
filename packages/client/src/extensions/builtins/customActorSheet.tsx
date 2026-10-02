import { createBoundInput } from "@rollforge/extension-api/client/binding";
import type { ClientExtensionAPI } from "@rollforge/extension-api";
import type { Document } from "@rollforge/protocol";

//  ActorSystem and the typed alias live here because this sheet is
// their only real owner. The protocol package stays generic — it just exports
// Document<TSystem = Record<string, unknown>>. Extension authors that want a
// strict shape declare it next to their own sheet component, same convention.
export interface ActorSystem {
  hp: { value: number; max: number };
  notes: string;
}
export type Actor = Document<ActorSystem>;

export interface CustomActorSheetProps {
  documentId: string;
  api: ClientExtensionAPI;
}

export function CustomActorSheet({ documentId, api }: CustomActorSheetProps) {
  const doc = api.documents.get<Actor>(documentId);
  if (!doc) {
    return (
      <div class="p-4 text-xs text-muted">Documento no cargado.</div>
    );
  }
  const hp = doc.system.hp;
  const notes = doc.system.notes;
  const BoundInput = createBoundInput(api);

  return (
    <div class="flex flex-col gap-4 p-4 text-xs text-[#e7e9ee]">
      <header class="flex flex-col gap-1">
        <label class="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Nombre
        </label>
        <BoundInput
          path="name"
          documentId={documentId}
          className="rounded bg-black/30 px-2 py-1 text-sm text-white border border-white/10 focus:border-accent outline-none"
        />
      </header>

      <section class="flex flex-col gap-2">
        <span class="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Puntos de Golpe
        </span>
        <div class="flex items-center gap-3">
          <div class="flex flex-col gap-1">
            <label class="text-[10px] text-muted">Actual</label>
            <BoundInput
              path="system.hp.value"
              documentId={documentId}
              type="number"
              className="w-20 rounded bg-black/30 px-2 py-1 text-sm text-white border border-white/10 focus:border-accent outline-none"
            />
          </div>
          <span class="text-muted mt-4">/</span>
          <div class="flex flex-col gap-1">
            <label class="text-[10px] text-muted">Máx</label>
            <BoundInput
              path="system.hp.max"
              documentId={documentId}
              type="number"
              className="w-20 rounded bg-black/30 px-2 py-1 text-sm text-white border border-white/10 focus:border-accent outline-none"
            />
          </div>
        </div>
        <div class="text-[10px] text-muted">
          Actual: <span class="font-mono">{hp.value}</span> · Máx:{" "}
          <span class="font-mono">{hp.max}</span>
        </div>
      </section>

      <section class="flex flex-col gap-1">
        <label class="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Notas
        </label>
        <BoundInput
          path="system.notes"
          documentId={documentId}
          className="rounded bg-black/30 px-2 py-1 text-xs text-white border border-white/10 focus:border-accent outline-none"
        />
        <span class="text-[10px] text-muted truncate">{notes}</span>
      </section>
    </div>
  );
}

export default CustomActorSheet;
