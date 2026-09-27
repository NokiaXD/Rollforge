# AGENTS.md — Rollforge

VTT monorepo (pnpm workspaces). Four packages in `packages/`:

| Package | Purpose | Notes |
|---|---|---|
| `@rollforge/protocol` | Shared types: `Document`, `Intent`, `SceneEvent`, manifest, hooks. | Exports **directly from `src/index.ts`** (no build needed for consumers). Build with `tsc -b` only to emit `.d.ts`. |
| `@rollforge/extension-api` | Frozen `api` surface (`server`, `client`, `testing`) handed to extensions. | Types-first; runtime helpers are just `Object.freeze`. |
| `@rollforge/server` | Express + socket.io. Authoritative state, drag-lock throttle, JWT/argon2 deps wired but auth runs at `resolveUserId = user-${socket.id}` in Fase 0. | Entrypoint: `src/main.ts`. |
| `@rollforge/client` | Vite + Preact + PixiJS. Pixi init is **async** (`await app.init(...)`). | Entrypoint: `src/main.tsx`; mounts `<App />` into `#ui-root` and Pixi into `#canvas-host`. |

Cross-package imports use `workspace:*` (already declared in each `package.json`).

## MCP `codebase` — use it first

The `codebase` MCP is available and indexed for this repo. Prefer it over raw `grep`/`glob` for structural queries:

- `search_graph` / `search_code` to find functions, callers, call chains, definitions.
- `trace_path` for impact analysis / who-calls-what.
- `get_architecture` / `get_graph_schema` for the package map and edge types.
- `query_graph` (Cypher) for multi-hop patterns, complexity/hot-path queries, dead code.

Verify it's indexed before relying on it (`codebase_index_status`); re-index with `codebase_index_repository` if empty. Fall back to `grep`/`read` only when the graph is stale or for tiny one-file lookups.

## Commands

- `pnpm install` from repo root.
- `pnpm dev` — runs every package's `dev` script in parallel (`server` on `:3000`, `client` on `:5173`).
- `pnpm -r build` — builds all. Server uses `tsup`, client uses `vite build`, protocol/extension-api use `tsc -b`.
- `pnpm -r test` — vitest everywhere. `client`/`server` have `--passWithNoTests`; `protocol`/`extension-api` fail on missing tests.
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
- Pixi HMR cleanup hook is in `packages/client/src/main.tsx` (`import.meta.hot.dispose`). Don't remove it — full reload leaks the previous `<canvas>`.

## TS gotchas

`tsconfig.base.json` enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `composite: true`.

- `Map.get` and array index returns `T | undefined` — guard before use.
- `exactOptionalPropertyTypes`: `{ foo?: string }` does **not** accept `{ foo: undefined }`. Pass `{}` or omit the key.
- Prefer `??` over `||` for defaulting signals/IDs (empty string is a valid sceneId).
- `composite: true` at the base means cross-package edits need `tsc -b` in `protocol`/`extension-api` if you change exported types; consumers resolve via `workspace:*` directly from `src/`, so `pnpm --filter @rollforge/client dev` re-resolves without rebuilding protocol.

## Commits (gitmoji required)

Every commit message **must** start with a single gitmoji (catalog: `gitmoji.json` at repo root — schema from [gitmoji.dev](https://gitmoji.dev)), followed by a space and the subject. Conventional prefixes (`feat:`, `fix:`) are **not** used here — the gitmoji replaces them.

Format: `<gitmoji> <subject>` — e.g. `✨ add drag-lock to scene state`, `🐛 reject stale _rev on MoveToken`.

Common picks: ✨ `:sparkles:` feature · 🐛 `:bug:` fix · 📝 `:memo:` docs · 🔥 `:fire:` remove · 🎨 `:art:` refactor/format · ⚡ `:zap:` perf · ✅ `:white_check_mark:` tests · 🔧 `:wrench:` config · ⬆️ `:arrow_up:` deps · 🚨 `:rotating_light:` fix lint/type warnings. Pick the closest one; don't invent new emojis.

## Known gaps (don't be surprised)

- Root `lint` script (`eslint "packages/*/src/**/*.ts"`) references ESLint but **no `eslint.config.{js,mjs}` or `.eslintrc*` exists** in the repo. Running `pnpm lint` currently fails with "No ESLint configuration found". Add the config before relying on it.
- `pnpm.onlyBuiltDependencies: ["esbuild"]` is pinned in root `package.json`; do not remove or pnpm will refuse to build native deps.
- `packageManager: pnpm@10.19.0` — keep Corepack enabled, do not switch package managers casually.
- No persistence yet: `SceneState` is in-memory; restart the server and tokens vanish. `better-sqlite3` is planned but not wired.
- `system.md` and `plan-implementacion.md` are design/roadmap docs, **not** the current implementation. Don't treat them as authoritative for what exists; verify in `packages/`.

## File map (what lives where)

- `packages/server/src/main.ts` — process entry, calls `createRollforgeServer()` + `listen(3000)`.
- `packages/server/src/server.ts` — Express + socket.io assembly; exposes `RollforgeServer`.
- `packages/server/src/sync/socket.ts` — all socket handlers, drag-lock throttle (`moveHzCap`), disconnect cleanup.
- `packages/server/src/sync/sceneState.ts` — authoritative token store + lock map.
- `packages/client/src/main.tsx` — bootstrap: render `<App />`, init Pixi, draw grid, start renderer, connect socket, join default scene.
- `packages/client/src/net/socket.ts` — `connectSocket`, `joinScene`, `sendIntent`, `createTokenRequest`.
- `packages/client/src/canvas/{pixiApp,sceneRenderer,tokens,grid}.ts` — canvas layer.
- `packages/client/src/state/scene.ts` — signals + `applyEvent` reducer.
- `packages/protocol/src/{documents,messages,hooks,manifest}.ts` — wire types. Edit here first when adding a new intent/event.
