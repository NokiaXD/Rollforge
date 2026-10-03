import { h } from "preact";

export function ExampleCharacterSheet({ documentId }) {
  return h(
    "div",
    { className: "example-character-sheet", "data-doc-id": documentId },
    h("h2", null, "Ficha de Personaje (Example RPG)"),
    h("p", null, `Document ID: ${documentId}`),
  );
}

export default function activate(api) {
  api.ui.registerSheet({
    documentType: "example-character",
    component: ExampleCharacterSheet,
    default: true,
  });
}
