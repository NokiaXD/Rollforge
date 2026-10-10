import { useEffect, useRef } from "preact/hooks";
import {
  openDocuments,
  closeDocument,
  focusDocument,
  windowFocusOrder,
} from "../state/ui";
import { documents, fetchDocument } from "../state/documents";
import { defaultSheetFor, sheetsFor } from "../extensions/clientSheets";
import { WindowFrame } from "./WindowFrame";
import {
  calculateCascadePosition,
  calculateWindowZIndex,
  getWindowDistanceFromTop,
  nextCascadeStep,
} from "./windowFrameUtils";

export function SheetModal() {
  const ids = openDocuments.value;
  if (ids.length === 0) return null;

  return (
    <>
      {ids.map((id) => (
        <DocumentWindow key={id} id={id} />
      ))}
    </>
  );
}

function DocumentWindow({ id }: { id: string }) {
  const initialPos = useRef(calculateCascadePosition(nextCascadeStep()));
  const distanceFromTop = getWindowDistanceFromTop(windowFocusOrder.value, `doc:${id}`);
  const zIndex = calculateWindowZIndex(distanceFromTop);

  useEffect(() => {
    if (id && !documents.value.has(id)) {
      void fetchDocument(id);
    }
  }, [id]);

  const doc = documents.value.get(id);

  const bringToFront = () => {
    focusDocument(id);
  };

  const handleClose = () => {
    closeDocument(id);
  };

  if (!doc) {
    return (
      <WindowFrame
        title="Cargando documento…"
        subtitle="Documento"
        backdrop="none"
        initialX={initialPos.current.x}
        initialY={initialPos.current.y}
        initialWidth={440}
        zIndex={zIndex}
        closeOnEscape={true}
        onFocus={bringToFront}
        onClose={handleClose}
      >
        <div class="p-6 text-sm text-muted">Cargando documento…</div>
      </WindowFrame>
    );
  }

  const sheet = defaultSheetFor(doc.type) ?? sheetsFor(doc.type)[0] ?? null;
  const Sheet = sheet?.component ?? null;

  return (
    <WindowFrame
      title={doc.name}
      subtitle={doc.type}
      backdrop="none"
      initialX={initialPos.current.x}
      initialY={initialPos.current.y}
      initialWidth={440}
      zIndex={zIndex}
      closeOnEscape={true}
      onFocus={bringToFront}
      onClose={handleClose}
    >
      {Sheet ? (
        <Sheet documentId={id} />
      ) : (
        <div class="p-4 text-xs text-muted">
          Sin ficha registrada para el tipo <span class="font-mono">{doc.type}</span>.
          <ul class="mt-2 list-disc pl-4 text-[11px] text-muted/70">
            <li>
              id: <span class="font-mono">{doc.id}</span>
            </li>
            <li>
              _rev: <span class="font-mono">{doc._rev}</span>
            </li>
          </ul>
          <pre class="mt-3 max-h-40 overflow-auto rounded bg-black/30 p-2 text-[10px] font-mono text-muted">
            {JSON.stringify(doc.system, null, 2)}
          </pre>
        </div>
      )}
    </WindowFrame>
  );
}