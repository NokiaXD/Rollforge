import { defineConfig } from "vitest/config";

// node, not jsdom: nothing here touches preact (the client entry is exercised
// by the host's own tests), and jsdom rewrites import.meta.url into an http
// URL, which breaks reading the pack fixture from disk.
export default defineConfig({
  test: {
    environment: "node",
  },
});
