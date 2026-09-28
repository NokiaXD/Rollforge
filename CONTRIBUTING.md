# Contributing

Thanks for taking a look. This doc covers the day-to-day workflow — the
project's design rationale lives in `plan-implementacion.md` and
`sistema.md`.

## Setup

Node 20+, pnpm 10.19 (Corepack pinned via `packageManager` in
`package.json`).

```sh
pnpm install
pnpm dev          # server :3000, client :5173
```

Start the server before the client — the Vite dev server proxies
`/api` and `/socket.io` (ws) to `http://localhost:3000`. If the server
is down, socket connections retry silently.

## Scripts

| | |
|---|---|
| `pnpm dev` | Runs every package's `dev` script in parallel. |
| `pnpm -r build` | Builds everything (`tsc -b`, `tsup`, `vite build`). |
| `pnpm -r test` | Vitest across the monorepo. |
| `pnpm lint` | ESLint over `packages/*/src/**/*.ts`. |

Single-package shortcuts:

```sh
pnpm --filter @rollforge/server test
pnpm --filter @rollforge/client exec vitest run src/path/foo.test.ts
```

## Commit format

Every commit message **must** start with a single gitmoji, followed by a space and the subject. No `feat:` /
`fix:` prefixes — the gitmoji replaces them.

Examples:

```
✨ add drag-lock to scene state
🐛 reject stale _rev on MoveToken
📝 document extension hooks API
🔧 chore(deps): bump pixi to 8.6
```

One emoji per commit. Subject in lowercase, imperative mood, no trailing
period. Pick the closest one from the catalog; don't invent new emojis.

## Code style

TypeScript strict everywhere. `tsconfig.base.json` enables
`composite: true`, `noUncheckedIndexedAccess`, and
`exactOptionalPropertyTypes`. A few consequences:

- `Map.get` and array index returns `T | undefined` — guard before use.
- `{ foo?: string }` does **not** accept `{ foo: undefined }`. Pass `{}`
  or omit the key.
- Prefer `??` over `||` for defaulting signals/IDs (empty string is a
  valid sceneId).
- Cross-package type changes in `protocol` / `extension-api` need
  `tsc -b` in those packages before downstream packages see them. In
  practice, consumers import directly from `src/`, so a downstream
  `pnpm dev` re-resolves without rebuilding.

Don't add comments unless they're load-bearing. Comments explaining
intent ("validates manifest, throws on conflict") stay; comments
narrating obvious code ("// loop through users") don't.

## Pull requests

- One logical change per PR. Bigger features split into stacked PRs.
- Branch from `main`. Rebase before merging.
- Run `pnpm -r test` and `pnpm lint` locally before requesting review.
- Use the PR template. Link the issue it closes with `Closes #N`.
- New protocol types: edit `packages/protocol/src/` first, then the
  consumers. The manager + hooks + manifest tests are the integration
  safety net.

## Reporting bugs

Use the bug report template. Minimum useful report:

- Repro steps (what you typed / clicked).
- Expected vs actual.
- Server log line (if the bug is on the server side).
- Browser + client log (if it's a renderer issue).
- Package versions from `pnpm -r --depth 0 ls`.

## Design changes

Open an issue with the **proposal** label before sending a PR for
anything that touches the extension API, the manifest schema, or the
socket protocol. The contract is the whole point of the project; we'd
rather discuss it than merge it.