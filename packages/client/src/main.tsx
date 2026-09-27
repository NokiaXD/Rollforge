import { render } from "preact";
import { signal } from "@preact/signals";

// ponytail: real Pixi canvas + viewport lands in Paso 4. Signals + UI shell only.
const boot = signal("RollForge boot OK");
render(<h1>{boot}</h1>, document.getElementById("app")!);