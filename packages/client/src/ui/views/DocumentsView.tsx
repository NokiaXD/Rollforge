import { useEffect } from "preact/hooks";
import type { Document } from "@rollforge/protocol";
import { deleteDocument, documents, fetchDocuments, listDocumentsByType, patchDocument } from "../../state/documents";
import { openContextMenu, openDocument, type ContextMenuItem } from "../../state/ui";
import { currentUser } from "../../state/auth";

const DEFAULT_ACTOR_OWNERSHIP = {
  default: "LIMITED" as const,
};

export function DocumentsView() {
  useEffect(() => {
    void fetchDocuments("Actor");
  }, []);

  const actors = listDocumentsByType("Actor");
  const isGM = currentUser.value?.role === "GM";

  const handleCreate = async () => {
    const id = `actor-${crypto.randomUUID().slice(0, 8)}`;
    const res = await fetch("/api/documents", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id,
        type: "Actor",
        name: "Nuevo Actor",
        system: { hp: { value: 10, max: 10 }, notes: "" },
        flags: {},
        ownership: { ...DEFAULT_ACTOR_OWNERSHIP },
      }),
    });
    if (res.ok) {
      const doc = (await res.json()) as import("@rollforge/protocol").Document;
      documents.value = new Map(documents.value).set(doc.id, doc);
      openDocument.value = doc.id;
    }
  };

  //  sin modal de rename todavía: prompt() + el PATCH que ya existe.
  const actorContextItems = (a: Document): ContextMenuItem[] => [
    { label: "Abrir ficha", onClick: () => (openDocument.value = a.id) },
    ...(isGM
      ? [
          {
            label: "Renombrar",
            onClick: () => {
              const name = window.prompt("Nombre del actor", a.name);
              if (name && name !== a.name) void patchDocument(a.id, { patch: { name } });
            },
          },
        ]
      : []),
    {
      label: "Copiar ID",
      hint: a.id,
      onClick: () => void navigator.clipboard?.writeText(a.id),
    },
    ...(isGM
      ? [
          { divider: true },
          {
            label: "Eliminar actor",
            danger: true,
            onClick: () => {
              if (window.confirm(`Eliminar actor "${a.name}"?`)) void deleteDocument(a.id);
            },
          },
        ]
      : []),
  ];

  return (
    <div
      class="custom-scroll flex h-full flex-col overflow-y-auto bg-transparent p-3 text-xs"
      onContextMenu={(e) => {
        if (!isGM) return e.preventDefault();
        openContextMenu(e, [{ label: "+ Crear Actor", onClick: handleCreate }]);
      }}
    >
      <div class="mb-3 flex items-center justify-between">
        <span class="font-semibold uppercase tracking-wider text-muted text-[11px]">
          Actores ({actors.length})
        </span>
        {isGM && (
          <button
            type="button"
            onClick={handleCreate}
            class="rounded bg-accent px-2 py-1 text-[11px] font-medium text-white hover:opacity-90 transition-opacity"
          >
            + Crear Actor
          </button>
        )}
      </div>

      {actors.length === 0 ? (
        <div class="flex flex-1 flex-col items-center justify-center p-6 text-center text-muted">
          <span class="text-2xl mb-2">🎭</span>
          <p class="font-medium">No hay actores todavía</p>
          <p class="text-[11px] text-muted/70 mt-1">
            {isGM
              ? "Pulsa \"+ Crear Actor\" para añadir el primero."
              : "Pide al GM que cree actores para la partida."}
          </p>
        </div>
      ) : (
        <div class="space-y-1.5">
          {actors.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => (openDocument.value = a.id)}
              onContextMenu={(e) => openContextMenu(e, actorContextItems(a))}
              class="flex w-full items-center justify-between rounded-md border border-white/5 bg-black/20 p-2 text-xs hover:border-white/10 hover:bg-black/30 transition-colors text-left"
            >
              <div class="min-w-0">
                <p class="font-medium text-white truncate">{a.name}</p>
                <p class="text-[10px] text-muted font-mono">{a.id}</p>
              </div>
              <span class="text-muted text-[10px]">→</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}