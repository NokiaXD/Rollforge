import { render } from "preact";
import { App } from "./ui/App";
import { fetchMe } from "./state/auth";
import "./style.css";

async function bootstrap() {
  render(<App />, document.getElementById("ui-root")!);
  await fetchMe();
}

void bootstrap();