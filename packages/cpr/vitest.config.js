import { defineConfig } from "vitest/config";

// node, not jsdom: the rules under test are pure functions over roll arrays
// (compendium/vitest.config.js has the same reasoning for its fixtures).
export default defineConfig({
  test: {
    environment: "node",
  },
});