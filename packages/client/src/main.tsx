import { render } from "preact";
import { App } from "./ui/App";
import { bootstrapClient } from "./extensions/bootstrap";
import "./style.css";

async function bootstrap() {
  // Order matters: setOwnerMap must run before any client-side extension
  // registers a default sheet. fetchMe runs first so an anon session's
  // /api/document-types is still a 401 (we treat as empty map and proceed
  // with BASE_TYPE_OWNERS only).
  await bootstrapClient();
  render(<App />, document.getElementById("ui-root")!);
}

void bootstrap();