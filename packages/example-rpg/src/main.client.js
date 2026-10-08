//  Served RAW at /api/extension-sources/example-rpg.js, so preact comes from
//  the host (api.ui.preact), never from `import "preact"`: the client's import
//  map hands out the unversioned optimizer url while the app imports the same
//  dep as `preact.js?v=<hash>`, i.e. two preacts and hooks that never render.

let h;

export function ExampleCharacterSheet({ documentId }) {
  return h(
    "div",
    { className: "example-character-sheet", "data-doc-id": documentId },
    h("h2", null, "Ficha de Personaje (Example RPG)"),
    h("p", null, `Document ID: ${documentId}`),
  );
}

export default function activate(api) {
  ({ h } = api.ui.preact);
  api.ui.registerSheet({
    documentType: "example-character",
    component: ExampleCharacterSheet,
    default: true,
  });
}
