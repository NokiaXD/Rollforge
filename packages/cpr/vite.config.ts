import { defineConfig } from "vite";

// Builds packages/cpr/src/main.client.tsx → dist/main.client.js.
//
// KEY: preact is NOT bundled into the output. The source only uses
// `import type` from preact (zero runtime), and h/Fragment/hooks are
// module-level variables assigned inside activate() from api.ui.preact.
// This means the host's single Preact instance does all rendering —
// no "second preact whose hooks throw __H of undefined".
//
// We don't use @preact/preset-vite because it auto-injects preact even
// when not needed. Instead: plain esbuild JSX classic transform pointing
// to the local `h` variable, and preact marked as external as a safeguard.

export default defineConfig({
  esbuild: {
    // Classic JSX transform: <div /> → h("div", ...) using the module-level `h`.
    jsx: "transform",
    jsxFactory: "h",
    jsxFragment: "Fragment",
    // Don't auto-import h/Fragment — they come from the activate() closure, and
    // jsxInject applies to every .tsx including the entry, where "./host" does
    // not resolve. Each component file imports `h` from ./host itself.
    jsxInject: undefined,
  },
  build: {
    lib: {
      entry: "src/main.client.tsx",
      formats: ["es"],
      fileName: () => "main.client.js",
    },
    rollupOptions: {
      // Safety net: if any value import from preact sneaks in, fail the build
      // rather than bundling a second instance.
      external: ["preact", "preact/hooks"],
    },
    outDir: "dist",
    emptyOutDir: true,
  },
});
