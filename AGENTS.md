# AGENTS.md — Rollforge

VTT monorepo (pnpm workspaces). Four packages in `packages/`:

| Package | Purpose | Notes |
|---|---|---|
| `@rollforge/protocol` | Shared types: `Document`, `Intent`, `SceneEvent`, manifest, hooks. | Exports **directly from `src/index.ts`** (no build needed for consumers). Build with `tsc -b` only to emit `.d.ts`. |
| `@rollforge/extension-api` | Frozen `api` surface (`server`, `client`, `testing`) handed to extensions. | Types-first; runtime helpers are just `Object.freeze`. |
| `@rollforge/server` | Express + socket.io. Authoritative state, drag-lock throttle, SQLite persistence, local accounts (argon2id) + opaque revocable sessions. | Entrypoint: `src/main.ts`. |
| `@rollforge/client` | Vite + Preact + PixiJS. Pixi init is **async** (`await createPixi(host)`). | Entrypoint: `src/main.tsx` mounts `<App />` into `#ui-root`; `App.tsx` mounts Pixi into `#canvas-host`. |

Cross-package imports use `workspace:*` (already declared in each `package.json`).

## MCP `codebase` — use it first

The `codebase` MCP is available and indexed for this repo. Prefer it over raw `grep`/`glob` for structural queries:

- `search_graph` / `search_code` to find functions, callers, call chains, definitions.
- `trace_path` for impact analysis / who-calls-what.
- `get_architecture` / `get_graph_schema` for the package map and edge types.
- `query_graph` (Cypher) for multi-hop patterns, complexity/hot-path queries, dead code.

Verify it's indexed before relying on it (`codebase_index_status`); re-index with `codebase_index_repository` if empty. Fall back to `grep`/`read` only when the graph is stale or for tiny one-file lookups.

## Agent role

The agent **only writes code**. It does not test the app manually (no `pnpm dev`, no browser, no live behavior checks). The user runs, tests, and feeds results back to the model, which then fixes.

### Flujo de trabajo obligatorio

1. **Explicar antes de implementar**: Antes de realizar modificaciones en el código de solución, el agente debe explicar con claridad qué va a hacer (diagnóstico, enfoque previsto y archivos a tocar).
2. **Creación y edición de tests permitida**: El agente puede crear y modificar archivos de test con total libertad cuando el código lo requiera.
3. **No ejecutar tests por iniciativa propia**: El agente **no ejecuta los tests** (`pnpm test`, `vitest`, etc.). La ejecución y validación pertenecen al usuario, quien correrá las pruebas y reportará los resultados para las correcciones necesarias.

### API first, system second

The next stretch of work is **building the game system, not the framework**. `packages/cpr` (Cyberpunk RED) is the driver: build what the system actually needs using the API as it exists today, and treat every API change as a consequence of real friction rather than a design in the abstract.

- **Do not** open a speculative core refactor. No "we'll need a lifecycle hook for this" pre-build.
- **Do** change the API the moment the system hits a wall — but then fix it once, in the core, for every caller (`sistema.md` §4: extensions never touch core internals).
- Prefer the smallest core seam that unblocks the system. If the extension can work around it, it works around it.
- Scaffold only what is backed by running code: a `documentType` with no migration chain, a sheet with no form, or a contribution nobody registers is a lie the host has to reconcile.

## Commands

- `pnpm install` from repo root.
- `pnpm dev` — runs every package's `dev` script in parallel (`server` on `:3000`, `client` on `:5173`). Goes through `scripts/dev.mjs`, which presets `ROLLFORGE_EXTENSIONS=<repo>/packages` so `example-rpg` loads; export the var yourself to override.
- `pnpm -r build` — builds all. Server uses `tsup`, client uses `vite build`, protocol/extension-api use `tsc -b`.
- `pnpm -r test` — vitest everywhere. `client`/`server` have `--passWithNoTests`; `protocol`/`extension-api` fail on missing tests.
- `pnpm lint` — eslint flat config, covers `packages/*/src/**/*.ts`.
- Single package: `pnpm --filter @rollforge/<name> <script>` (e.g. `pnpm --filter @rollforge/server test`, `pnpm --filter @rollforge/client dev`).
- Single test file: `pnpm --filter @rollforge/server exec vitest run src/sync/socket.test.ts`.

## Network / ports

- Server listens on **3000** (`listen(server, 3000)`).
- Client dev server on **5173** (`vite.config.ts`) proxies `/api` and `/socket.io` (ws) to `http://localhost:3000`. Start the server before the client, or socket connection silently retries.

## Socket protocol (Fase 0)

- Events: `joinScene`, `leaveScene`, `intent`, `createToken`. Server emits `you`, `event`, `tokenCreated`, `intentRejected`.
- Rooms are named `scene:<sceneId>` — clients must `joinScene` to receive room broadcasts.
- Every `Token` and every `TokenPositionDiff` carries `_rev`. Server rejects `MoveToken` when `_rev` is stale **or** when the drag lock is held by someone else (`intentRejected` with `reason: "stale-or-locked"` or `"locked"`).
- Drag locks (`AcquireDragLock` / `ReleaseDragLock`): only the lock owner may move that token. Locks are released automatically on `disconnect` (`releaseAllFor(userId)` in `sync/socket.ts`).
- Client `applyEvent` in `packages/client/src/state/scene.ts` ignores events with `ev._rev <= t._rev` — never bump `_rev` outside `SceneState.moveToken` or you'll desync clients.

## State (client)

- `@preact/signals` is the reactive store. `tokens`, `locks`, `currentSceneId`, `myUserId`, `cellSize` are signals.
- `SceneRenderer` reconciles sprites via `effect(() => reconcile(tokens.value, sendIntent))` in `packages/client/src/canvas/sceneRenderer.ts`. New token ⇒ create sprite; missing ⇒ `sprite.destroy()`.
- Pixi HMR cleanup hook is in `packages/client/src/ui/App.tsx` (`import.meta.hot.dispose`). Don't remove it — full reload leaks the previous `<canvas>`.

## TS gotchas

`tsconfig.base.json` enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `composite: true`.

- `Map.get` and array index returns `T | undefined` — guard before use.
- `exactOptionalPropertyTypes`: `{ foo?: string }` does **not** accept `{ foo: undefined }`. Pass `{}` or omit the key.
- Prefer `??` over `||` for defaulting signals/IDs (empty string is a valid sceneId).
- `composite: true` at the base means cross-package edits need `tsc -b` in `protocol`/`extension-api` if you change exported types; consumers resolve via `workspace:*` directly from `src/`, so `pnpm --filter @rollforge/client dev` re-resolves without rebuilding protocol.

## Auth

- Local accounts only (first registered user becomes GM), argon2id hashes, login rate limit. No Discord OAuth yet.
- The session cookie `rf_session` holds an **opaque random id** (256-bit `randomBytes`), not a signed token. Revoking = deleting the row in `SessionsStore` (`auth/sessions.ts`, `data/sessions.db`). The role is *not* stored in the row — `resolveSession` looks it up live in `UsersStore` so a role change applies without re-login.
- Sessions live in their own db, not the world db, because `users` are global to the install rather than per-world.
- Socket handshake resolves the same cookie (`io.use` in `server.ts`) → `socket.data.authSession` as `{ sub, role }`. Unauthenticated sockets fall back to `user-${socket.id}` / `role: null`.

## Dice

- Notation parsing and validation are in `@rollforge/protocol` (`dice.ts`: `parseDiceTerms`, `validateDice`, `DICE_LIMITS`) so the client and Fase 2 extensions can parse without duplicating it.
- Actual rolling stays server-side in `server/src/dice/adapter.ts` — it needs `@dice-roller/rpg-dice-roller` and the crypto RNG. `rollDice` is the only entry point; the server result is authoritative (see §10: extensions animate, they never decide).

## Commits (gitmoji required)

Every commit message **must** start with a single gitmoji (catalog: `gitmoji.json` at repo root — schema from [gitmoji.dev](https://gitmoji.dev)), followed by a space and the subject. Conventional prefixes (`feat:`, `fix:`) are **not** used here — the gitmoji replaces them.

Format: `<gitmoji> <subject>` — e.g. `✨ add drag-lock to scene state`, `🐛 reject stale _rev on MoveToken`.

Common picks: ✨ `:sparkles:` feature · 🐛 `:bug:` fix · 📝 `:memo:` docs · 🔥 `:fire:` remove · 🎨 `:art:` refactor/format · ⚡ `:zap:` perf · ✅ `:white_check_mark:` tests · 🔧 `:wrench:` config · ⬆️ `:arrow_up:` deps · 🚨 `:rotating_light:` fix lint/type warnings. Pick the closest one; don't invent new emojis.

## Known gaps (don't be surprised)

- `onlyBuiltDependencies: ["esbuild", "better-sqlite3"]` is pinned in `pnpm-workspace.yaml`; do not remove or pnpm will refuse to build native deps. (pnpm 10 ignores it in `package.json` — that is where the warning came from.)
- `packageManager: pnpm@10.19.0` — keep Corepack enabled, do not switch package managers casually.
- `authorizeAction` (`security/authorize.ts`) is a placeholder that always returns `true` — chat permission checks are not centralized yet.
- Whispers are persisted in `chatStore` with `whisper_to` and scoped in `recent()` so only sender and recipient receive them in `chatHistory`.
- The client extension host is thin: `client/src/extensions/extensionLoader.ts` fetches `/api/extension-sources` and imports each `main.client.js` raw, handing it a `ClientExtensionAPI` from `buildClientAPI(extensionId)`. Paso 24 added `api.canvas` + `api.scene`; Paso 20b added `api.hooks.on/off` (below). The import map still only exists under the Vite dev server.
- **`api.hooks` on the client is NOT the server hook engine.** It is a flat handler list (`client/src/extensions/clientHooks.ts`) fed by the host's own transport, and the only event it emits today is `"chatMessage"` (live socket messages only — chat history is never replayed). `filter` stays a no-op. `on("postDiceRoll")` on a client extension silently never fires.
- Document types can declare `scope: "compendium"` (`contributes.documentTypes[].scope`). Those types are (a) excluded from the eager migration loop, (b) read-only over HTTP (POST/PATCH/DELETE → 403). The owning extension still writes them in-process. `lint.documentWrites.test.ts` keeps the allowlist of files that may write the `documents` table, so a new writer has to decide about that gate.
- `POST /api/documents` accepts `{ id, type, sourceId }` with **no** `system` to import an existing document (compendium entries, duplicate actors). The host resolves the source, migrates it if stale, and refuses blocked (`409 migration-blocked`) or too-new (`409 schema-too-new`) sources. A client-supplied `schemaVersion` is discarded in both the create and the import branch.
- Drag & drop from a compendium to the scene is **not** built yet (plan § Paso 18, "Pendiente"). The drop would be `POST { sourceId, type }` + `createTokenRequest`, but dnd-kit is not exposed to extension code.
- `clientSheets.ts` infers each `documentType`'s owner from the order of `registerSheet` calls. The server uses the declarative `DocumentTypeRegistry` instead. They agree today only because the bootstrap is the sole client-side registration; this will diverge the first time a real Fase 2 extension contributes a sheet client-side. Plan + fix in `docs/plan-implementacion.md` § Paso 17.
- Document IDs are strictly validated on creation in `DocumentStore.save()` (`/^[a-zA-Z0-9_-]{1,128}$/`), centralizing rejection of path traversal / control characters across both HTTP routes and extension API.
- Undocking (pop-out ↗) or docking a panel remounts its component and resets component-local state (scroll position, transient text inputs). `ChatView` automatically scrolls to bottom on mount to mitigate this.


## Extensions

- Layout on disk: `<dataDir>/extensions/<id>/extension.json` + `main.server.js`. Override the root with `extensionsDir` or `ROLLFORGE_EXTENSIONS`. A missing directory is a no-op. Client-side entries (`main.client.js`) are served raw at `/api/extension-sources/:id.js`; their bare imports resolve through the import map in `packages/client/index.html` (`@rollforge/*` only), which only exists under the Vite dev server — serving the built client from Express still needs that map replaced. `preact` is deliberately NOT in that map: the optimizer serves the app `preact.js?v=<hash>` and the map `preact.js`, so an extension that imports it gets a second preact whose hooks throw `__H of undefined` — take `h` + hooks from `api.ui.preact` instead. **The served file is parsed by the browser as plain ESM: no JSX (use `h()`), and no relative imports** (a `import "./panel.js"` would 404). The server serves only `<root>/<main.client>`, so a client extension is a single file.
- `main.server` is a plain ESM module dynamically imported by `extensions/loader.ts` with `pathToFileURL` — a raw Windows path is not a valid `import()` specifier. It must stay inside the extension folder.
- Discovery is per-extension fault-tolerant and idempotent: a broken manifest, an incompatible `engines.core` or a missing entry file is logged and skipped, never thrown. Already-registered ids are skipped, so re-running the loader is safe.
- Disk extensions are registered **before** the first `dispatchActivationEvent("onReady")` — registering later would make an `onReady` extension invisible forever.
- Builtins stay as in-repo TS modules in `src/extensions/builtins/` under a lint boundary (`extensions/lint.test.ts` forbids imports outside that folder, `node:*`, and dynamic `import()`).


## File map (what lives where)

- `packages/server/src/main.ts` — process entry, calls `createRollforgeServer()` + `listen(3000)`.
- `packages/server/src/server.ts` — Express + socket.io assembly; exposes `RollforgeServer`.
- `packages/server/src/db/{connection,migrations,documentStore,chatStore}.ts` — SQLite open, `coreSchemaVersion` runner, documents + chat persistence.
- `packages/server/src/auth/{usersStore,sessions,routes,middleware}.ts` — accounts, opaque sessions, HTTP auth routes.
- `packages/server/src/extensions/{manager,manifest,loader,registry}.ts` — lifecycle, manifest validation, disk discovery, chat commands.
- `packages/server/src/sync/socket.ts` — all socket handlers, drag-lock throttle (`moveHzCap`), disconnect cleanup.
- `packages/server/src/sync/sceneState.ts` — authoritative token store + lock map.
- `packages/client/src/main.tsx` — bootstrap: render `<App />` into `#ui-root`, trigger `fetchMe()` auth check.
- `packages/client/src/ui/App.tsx` — mounts canvas, inits Pixi, draws grid & background, starts renderer, connects socket.
- `packages/client/src/net/socket.ts` — `connectSocket`, `joinScene`, `sendIntent`, `createTokenRequest`.
- `packages/client/src/canvas/{pixiApp,currentViewport,sceneRenderer,tokens,grid}.ts` — canvas layer. `currentViewport.ts` is the one place the viewport is reachable from outside `App.tsx`; `App.tsx` publishes it on mount and clears it on cleanup.
- `packages/client/src/state/scene.ts` — signals + `applyEvent` reducer.
- `packages/client/src/extensions/{bootstrap,clientPanels,clientHooks}.tsx|ts` — the client host: builds the frozen `ClientExtensionAPI`, holds the sheet + panel registries, and owns the client hook bus.
- `packages/compendium` — the official compendium extension (Paso 18): two documentTypes, one chain, a JSON pack, `/compendio packs|load`. Its `main.client.js` registers a sidebar panel and the imported-monster sheet.
- `packages/ruler` — the official ruler extension (Paso 24): grid measurement in line/square/circle, drawn straight onto the Pixi viewport through `api.canvas`. See `PLAN-regla.md` at the repo root.
- `packages/dice3d` — the official dice animation extension (Paso 20b): client-only, animates the server's `ChatMessageEvent.result` in CSS 3D. No `main.server.js`, no deps.
- `packages/cpr` — the Cyberpunk RED system (the driver, see *API first, system second*). Scaffold only: manifest with empty `contributes` + no-op `main.server.js` / `main.client.js`.
- `packages/protocol/src/{documents,messages,hooks,manifest,dice}.ts` — wire types + dice notation. Edit here first when adding a new intent/event.

## Ruler / `api.canvas` (Paso 24)

- `SceneSystem` has two **optional** fields for the measurement scale: `cellLength` (real length of one cell, in `units`) and `units` (`"ft" | "m"`). They are optional because `Scene` is a base type: no registry entry, so `currentSchemaVersion("Scene")` is `undefined` and `migrateIfStale()` returns early — **no migration chain can ever apply**. The `?? 5` / `?? "ft"` fallback lives in exactly one place, `buildClientAPI`.
- `SceneSystem` edits must be added to **both** `system` literals in `SceneFormModal.submit` (create and edit). `updateScene()` replaces `system` wholesale, so a field missing from either literal is silently dropped on save.
- `api.canvas` / `api.scene` are the **one documented exception** to "extensions never touch core internals" (`sistema.md` §4, §13). An extension that draws is coupled to whatever renderer the core uses. Revisit when a second extension actually draws something.
- `api.canvas.viewport` is a **getter**: extensions activate before `ui/App.tsx` creates Pixi, so a captured value would be null forever. `deepFreeze` skips accessors for exactly this reason — reading one would run it and freeze Pixi's whole object graph. Skipping does not open an assignment path (accessor with no setter, ESM strict mode).
- `api.canvas.pixi` **hands over the Pixi classes** rather than letting extensions import `pixi.js`. A raw-served client file can only resolve what the import map covers, and that map only exists under the Vite dev server — so `import "pixi.js"` from an extension breaks on a build served by Express. This makes the ruler work in the Express-served build too.
- `api.scene` are **plain getters, not signals**: the raw-served file cannot import `@preact/signals` either. There is no `onFrame`; overlays redraw on their own pointer events, which is when the scale actually matters.
- A client extension is **one file, no JSX, no relative imports** — the server serves only `<root>/<main.client>` and the browser parses it as plain ESM. Use `h()` like `compendium/src/main.client.js` does.
- The client half has **no unload path**: `deactivateExtension` is only called from `server.ts`'s `close()` — no HTTP route, no GM UI. The served file is not in Vite's HMR graph, so it never re-activates within a page session. The only re-entry is HMR of `ui/App.tsx`, which recreates Pixi; `api.canvas.onReady` fires for **every** viewport and the extension must detach from the old one first.
- Every client extension reimplements its own keyboard guard against `INPUT`/`TEXTAREA`/`SELECT`/`contentEditable`, because the host handler in `ui/App.tsx` does not filter them. Generalize it into a contribution point with the second consumer, not the first.
