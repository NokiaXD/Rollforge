import { defineConfig } from "vitest/config";

// node, not jsdom: the only thing the test touches is `measure()`, which is pure.
// jsdom rewrites import.meta.url into an http URL, which breaks disk reads.
export default defineConfig({
  test: {
    environment: "node",
  },
});
