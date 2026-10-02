import { useEffect } from "preact/hooks";
import { openDocument } from "../state/ui";
import { documents, fetchDocument } from "../state/documents";
import { defaultSheetFor, sheetsFor } from "../extensions/clientSheets";

export function SheetModal() {
  const id = openDocument.value;
  useEffect(() => {
    if (id && !documents.value.has(id)) void fetchDocument(id);
  }, [id]);

  if (!id) return null;

  const doc = documents.value.get(id);
  if (!doc) {
    return (
      <div class="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div class="rounded-lg border border-white/10 bg-[#14171c] p-6 text-sm text-muted shadow-2xl">
          Cargando documento…
        </div>
      </div>
    );
  }

  const sheet = defaultSheetFor(doc.type) ?? sheetsFor(doc.type)[0] ?? null;
  const Sheet = sheet?.component ?? null;

  return (
    <div class="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div class="pointer-events-auto flex max-h-[80vh] w-[420px] max-w-[92vw] flex-col rounded-lg border border-white/10 bg-[#14171c] shadow-2xl">
        <header class="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-2.5">
          <div class="flex flex-col">
            <span class="text-[10px] font-semibold uppercase tracking-wider text-muted">
              {doc.type}
            </span>
            <span class="text-sm font-semibold text-white">{doc.name}</span>
          </div>
          <button
            type="button"
            onClick={() => (openDocument.value = null)}
            class="rounded p-1 text-muted hover:bg-white/5 hover:text-white transition-colors"
            title="Cerrar"
          >
            ✕
          </button>
        </header>
        <div class="custom-scroll flex-1 overflow-y-auto">
          {Sheet ? (
            <Sheet documentId={id} />
          ) : (
            <div class="p-4 text-xs text-muted">
              Sin ficha registrada para el tipo <span class="font-mono">{doc.type}</span>.
              <ul class="mt-2 list-disc pl-4 text-[11px] text-muted/70">
                <li>id: <span class="font-mono">{doc.id}</span></li>
                <li>_rev: <span class="font-mono">{doc._rev}</span></li>
              </ul>
              <pre class="mt-3 max-h-40 overflow-auto rounded bg-black/30 p-2 text-[10px] font-mono text-muted">
                {JSON.stringify(doc.system, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}