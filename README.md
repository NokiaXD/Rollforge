# Rollforge

Open-source Virtual Tabletop (VTT) with a VS Code-style extension API.
Map, tokens, dice, chat, and permissions live in a minimal core; the
rest — character sheets, dice modifiers, automation, custom document
types — is built as extensions on top.

Status: **Phase 1** (playable core + extension mechanism, dogfooding in
progress). See [Roadmap](#roadmap).

## Quick start

```sh
pnpm install
pnpm dev          # server on :3000, client on :5173
```

Server first, then client (the client proxies `/api` and `/socket.io` to
`http://localhost:3000`). Restart the server to apply socket changes; the
client hot-reloads.

Other scripts:

```sh
pnpm -r build     # build every package
pnpm -r test      # vitest across the monorepo
pnpm lint         # ESLint over packages/*/src
```

Node 20+, pnpm 10.19 (Corepack pinned).

## Packages

| Package | What it is |
|---|---|
| `@rollforge/protocol` | Shared types: `Document`, `Intent`, `SceneEvent`, hook payloads, manifest schema. Imported directly from `src/`, no build step. |
| `@rollforge/extension-api` | The frozen surface handed to extensions: `server`, `client`, `testing`, plus `HooksEngine` and `CommandRejection`. |
| `@rollforge/server` | Express + socket.io. Authoritative state, drag-lock throttle, chat persistence (better-sqlite3), extension manager. |
| `@rollforge/client` | Vite + Preact + PixiJS 8. Pixi init is async (`await app.init(...)`). Mounts `<App />` into `#ui-root`, Pixi into `#canvas-host`. |

Cross-package imports use `workspace:*`.

## Extension system

The point of the project. Extensions are first-class:

- **Manifest** (`ExtensionManifest`) declares `id`, `version`, `engines.core`,
  `activationEvents`, and `contributes` (chat commands, document types, etc.).
  `builtin: true` opts out of the core semver check (for extensions shipped
  with the server).
- **Manager** (`ExtensionManager`) validates manifests, scopes the API per
  extension (`extensionId`), runs activation on a timeout, and tears down
  hooks/commands on deactivate.
- **Hooks** (`HooksEngine`) are notifiers + filters. Filters return `null` to
  abort. Notify handlers run via `Promise.allSettled`; errors log with the
  owning extension id.
- **Commands** are registered through `chat.registerCommand` and gated by
  `requiredPermission: "GM" | "Player"`. Built-ins (`/roll`, `/w`,
  `/whisper`) are themselves a contributed extension
  (`packages/server/src/extensions/builtins/chatDice.ts`) — the core ships
  no chat command handlers.

Authoring an extension:

```ts
import { CommandRejection, type ServerExtensionAPI } from "@rollforge/extension-api";

export const manifest = {
  id: "my-ext",
  name: "My Extension",
  version: "0.1.0",
  engines: { core: ">=0.1.0" },
  activationEvents: ["onCommand:foo"],
  contributes: {
    chatCommands: [{ name: "foo", description: "Do something" }],
  },
} as const;

export function activate(api: ServerExtensionAPI) {
  api.chat.registerCommand({
    name: "foo",
    description: "Do something",
    handler: async ({ args, rest }, ctx) => {
      api.chat.send(`got: ${rest}`);
    },
  });
}
```

The frozen API exposes: `documents`, `hooks`, `chat`, `dice`, `users`,
`context`, `errors`. `freezeServerAPI` deep-freezes the entire object so
extensions can't reach into internals.

## Roadmap

Per `plan-implementacion.md`:

| | |
|---|---|
| 0 | Stack + skeleton. Token drag, no persistence. ✅ |
| 1 | Playable core + dogfood + minimal extension mechanism. **In progress.** |
| 2 | Extension API v1.0 — full contribution points, semver contract. |
| 3 | Macros, compendia, inventory as official extensions. 3D dice (`@3d-dice/dice-box`) hooks `postDiceRoll` lazily. |
| 4 | Community index, RFC process, BDFL transition. |

## Contributing

See `CONTRIBUTING.md`. Commits use a single leading gitmoji; no `feat:` / `fix:` prefixes. TS strict mode is on,
including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.

## License

- Core code: MIT. See `LICENSE`.
- Extensions contributed in-tree (`packages/server/src/extensions/builtins/`):
  GPL-3.0-or-later. See `LICENSE-CONTRIB`.
- Third-party extensions you install are not bound by this repo's license.