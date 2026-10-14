//  Cyberpunk RED — client extension entry.
//
//  Served as /api/extension-sources/cpr.js after `vite build` compiles this
//  file to dist/main.client.js. The browser loads it as plain ESM, so the
//  relative imports below are bundled away by the build — the shipped artifact
//  is still a single file.
//
//  KEY: h / Fragment / hooks come from api.ui.preact (the HOST's Preact copy),
//  assigned in activate() before any component renders. We only use
//  `import type` from preact so the build emits zero preact runtime — no second
//  Preact instance, no broken hooks.

import type { ClientExtensionAPI } from "@rollforge/extension-api";

import { CharacterSheet } from "./client/CharacterSheet";
import { CprPanel } from "./client/CprPanel";
import { setHost } from "./client/host";
import { CHAR_TYPE } from "./client/rules";
import styles from "./client/cpr.css?inline";

export default function activate(hostApi: ClientExtensionAPI) {
  // Inject self-contained CPR stylesheet into host document once
  if (typeof document !== "undefined" && !document.getElementById("cpr-styles")) {
    const el = document.createElement("style");
    el.id = "cpr-styles";
    el.textContent = styles;
    document.head.appendChild(el);
  }

  // Pull h/hooks + api from the host — same Preact instance the app uses.
  setHost(hostApi);

  hostApi.ui.registerSheet({
    documentType: CHAR_TYPE,
    component: CharacterSheet as never,
    default: true,
  });

  hostApi.ui.registerPanel({
    id: "cpr",
    title: "Cyberpunk RED",
    icon: "nf-fa-dice_d20",
    component: CprPanel as never,
    documentTypes: [CHAR_TYPE],
  });
}