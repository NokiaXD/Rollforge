//  Served RAW at /api/extension-sources/:id.js, so this file can only use
//  what the host hands it: no relative imports (an `import "./pack.js"` would
//  404), which is why PACK_TYPE and IMPORT_TYPE are repeated here instead of
//  shared with src/pack.js. One comment, one duplication — not a module system.
//
//  No `import "preact"` either: index.html's import map resolves it to the
//  unversioned optimizer url while the app imports the same dep as `?v=<hash>`,
//  so the extension would get a second preact whose hooks never render (every
//  useState throws "__H of undefined"). api.ui.preact is the host's preact.
//
//  No createBoundInput either: @rollforge/extension-api/client/binding is not
//  in the import map, and extending the map for a demo field is not worth it.

const PACK_TYPE = "compendium-actor";
const IMPORT_TYPE = "compendium-monster";

//  Assigned by activate() below. They are only read while a component renders,
//  which cannot happen before the panel is registered.
let h, useRef, useState;

function NumberField(props) {
  const { api, documentId, path, value } = props;
  const [status, setStatus] = useState("");
  const timer = useRef(null);

  const onInput = (e) => {
    const parsed = Number(e.currentTarget.value);
    setStatus("guardando…");
    clearTimeout(timer.current);
    // Same 350ms debounce as the core BoundInput; a number input fires on
    // every keystroke and each one would otherwise be a server write.
    timer.current = setTimeout(async () => {
      try {
        await api.documents.update(documentId, { [path]: Number.isFinite(parsed) ? parsed : 0 });
        setStatus("guardado");
      } catch (err) {
        setStatus(err && err.reason ? err.reason : "network-error");
      }
    }, 350);
  };

  return h(
    "label",
    { class: "flex items-center justify-between gap-2 text-[11px]" },
    h("span", { class: "text-muted" }, props.label),
    h("input", {
      type: "number",
      value: value ?? 0,
      onInput,
      class: "w-20 rounded border border-white/10 bg-black/30 px-1 py-0.5 text-right",
    }),
    status ? h("span", { class: "text-[10px] text-muted" }, status) : null,
  );
}

/**
 * Sheet for an IMPORTED monster (IMPORT_TYPE). Its existence is the proof
 * that an import produced ordinary, editable campaign state: the wrapper
 * type is read-only over HTTP, so if the import had kept the pack's type
 * these inputs would come back 403 forbidden.
 */
export function MonsterSheet({ documentId, api }) {
  const doc = api.documents.get(documentId);
  if (!doc) return h("p", { class: "text-muted text-xs" }, "Cargando…");
  const system = doc.system ?? {};
  const blocked = doc.migrationStatus === "blocked";

  return h(
    "div",
    { class: "space-y-2" },
    h("h2", { class: "text-sm font-semibold" }, doc.name),
    h("p", { class: "text-[10px] font-mono text-muted" }, `${doc.type} · v${doc.schemaVersion}`),
    blocked
      ? h(
          "p",
          { class: "rounded border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-200" },
          "Migración bloqueada: esta entrada no pudo migrarse a la versión actual. " +
            "El GM puede revisarla con /migrations review.",
        )
      : null,
    h(NumberField, { api, documentId, path: "system.ac", value: system.ac, label: "CA" }),
    h(NumberField, {
      api,
      documentId,
      path: "system.hp.current",
      value: system.hp && system.hp.current,
      label: "PV",
    }),
    Array.isArray(system.traits)
      ? h(
          "p",
          { class: "text-[11px] text-muted" },
          `Rasgos: ${system.traits.join(", ")}`,
        )
      : null,
  );
}

async function importEntry(id) {
  const res = await fetch("/api/documents", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    // No `system` on purpose. The host resolves the source, migrates it if it
    // is stale, and refuses if it is blocked — the client cannot talk it into
    // copying a half-migrated document.
    body: JSON.stringify({
      id: `monster-${crypto.randomUUID().slice(0, 8)}`,
      type: IMPORT_TYPE,
      sourceId: id,
      ownership: { default: "LIMITED" },
    }),
  });
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => ({}));
  return { ok: false, reason: body.error ?? `http-${res.status}` };
}

function CompendiumPanel({ entries }) {
  const [status, setStatus] = useState("");

  const onImport = async (id) => {
    setStatus("Importando…");
    const r = await importEntry(id);
    if (r.ok) {
      setStatus("Importado. Aparece en Actores.");
    } else {
      setStatus(`No se pudo importar: ${r.reason}`);
    }
  };

  return h(
    "div",
    { class: "custom-scroll flex h-full flex-col overflow-y-auto p-3 text-xs" },
    h(
      "div",
      { class: "mb-2 flex items-center justify-between" },
      h(
        "span",
        { class: "font-semibold uppercase tracking-wider text-muted text-[11px]" },
        `Entradas (${entries.length})`,
      ),
      h("span", { class: "text-[10px] text-muted font-mono" }, PACK_TYPE),
    ),
    status ? h("p", { class: "mb-2 text-[11px] text-accent" }, status) : null,
    entries.length === 0
      ? h(
          "div",
          { class: "flex flex-col items-center justify-center p-6 text-center text-muted" },
          h("span", { class: "mb-2 text-2xl" }, "\ud83d\udcbe"),
          h("p", { class: "font-medium" }, "El pack no está cargado"),
          h(
            "p",
            { class: "mt-1 text-[11px] text-muted/70" },
            "El GM puede cargarlo con /compendio load demo-monsters",
          ),
        )
      : h(
          "div",
          { class: "space-y-1.5" },
          entries.map((entry) => {
            const blocked = entry.migrationStatus === "blocked";
            return h(
              "div",
              {
                key: entry.id,
                class: "flex items-center justify-between gap-2 rounded-md border border-white/5 bg-black/20 p-2",
              },
              h(
                "div",
                { class: "min-w-0" },
                h("p", { class: "truncate font-medium text-white" }, entry.name),
                h(
                  "p",
                  { class: "font-mono text-[10px] text-muted" },
                  blocked ? `v${entry.schemaVersion} · BLOQUEADA` : `v${entry.schemaVersion}`,
                ),
              ),
              blocked
                ? h(
                    "span",
                    { class: "text-[10px] text-red-300", title: "La migración de esta entrada falló" },
                    "migración fallida",
                  )
                : h(
                    "button",
                    {
                      type: "button",
                      class: "rounded bg-accent px-2 py-1 text-[11px] font-medium text-white hover:opacity-90",
                      onClick: () => void onImport(entry.id),
                    },
                    "Importar",
                  ),
            );
          }),
        ),
  );
}

export default function activate(api) {
  ({ h, useRef, useState } = api.ui.preact);
  api.ui.registerSheet({
    documentType: IMPORT_TYPE,
    component: (props) => h(MonsterSheet, { ...props, api }),
    default: true,
  });
  api.ui.registerPanel({
    id: "compendium",
    title: "Compendio",
    icon: "nf-cod-book",
    component: CompendiumPanel,
    // The host prefetches these and hands them over as `entries`, so this
    // component never fetches anything itself.
    documentTypes: [PACK_TYPE],
  });
}
