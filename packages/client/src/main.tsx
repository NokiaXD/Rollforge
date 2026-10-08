import { render } from "preact";
import { App } from "./ui/App";
import { bootstrapClient } from "./extensions/bootstrap";
import "./style.css";

async function bootstrap() {
  // Order matters: setOwnerMap must run before any client-side extension
  // registers a default sheet. fetchMe runs first because the extension
  // endpoints are behind requireAuth — while anon we skip them entirely and
  // the auth watcher in bootstrapClient runs them once the login lands.
  await bootstrapClient();
  render(<App />, document.getElementById("ui-root")!);
}

void bootstrap();