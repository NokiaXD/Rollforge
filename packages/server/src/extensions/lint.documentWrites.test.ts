import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";

//  The scope:"compendium" read-only gate lives in the HTTP routes
//  (db/documentRoutes.ts). That is only complete as long as those routes
//  are the only EXTERNAL write paths into the documents table — and today
//  that is a coincidence, not an invariant: sync/sceneState.ts also writes
//  the same table straight from socket intents, and it is the reason no
//  UpdateDocument intent slipped through the gate. It is safe purely because
//  it hardcodes its document types (Token/Scene/Folder/Setting) and cannot
//  address a pack entry id.
//
//  This test turns that coincidence into a CI-enforced property: any new
//  writer must be added to the allowlist below with a justification, which
//  forces whoever adds it to decide whether the scope gate applies. Same
//  reasoning as the id-format validation in DocumentStore.save() and as
//  lint.adminCommand.test.ts: one gate, and a test that keeps it the only one.

const ALLOWED_WRITER_PATHS = [
  // The three HTTP verbs, where the scope gate and the ownership gate live.
  "src/db/documentRoutes.ts",
  // Socket intents for tokens/scenes/folders. Writes the same table, but
  // only ever with the literal types listed above — it cannot name a
  // compendium document. If that ever changes, this entry is the place to
  // revisit.
  "src/sync/sceneState.ts",
  // createScopedAPI's api.documents.update/delete: the in-process path the
  // owning extension uses to populate its own pack. Deliberately ungated —
  // extensions are server-side code, not untrusted clients.
  "src/extensions/manager.ts",
  // The host's getDocumentsAPI bridge — the object whose create/update/delete
  // the manager's scoped api.documents delegates to. Reachable only from
  // createScopedAPI (gates applied there) and from the routes.
  //
  // Found by this test the first day it ran, not by inspection: it was not on
  // the radar when the gate was written. Kept as a decision, not a concession
  // — it is the only wiring that makes the in-process extension API reach the
  // store at all, so deleting it would break Paso 18's own pack population.
  // If a future change adds a second caller of this bridge from outside the
  // manager, that is the moment the gate has to move down here.
  "src/server.ts",
];

// What counts as a write. Deliberately narrow: the in-memory maps and the
// token/session stores that happen to expose .delete() are not documents.
const WRITE_PATTERNS = [
  /\bstore\s*\.\s*save\s*\(/,
  /\bstore\s*\.\s*update\s*\(/,
  /\bstore\s*\.\s*delete\s*\(/,
  /\bgetDocumentsAPI\(\)\s*\.\s*(update|delete|create)\s*\(/,
  /\bopts\s*\.\s*store\s*\.\s*(save|update|delete)\s*\(/,
  /\bthis\s*\.\s*store\s*\?\s*\.\s*(save|update|delete)\s*\(/,
];

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      out.push(...walkTs(p));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

describe("document write-path boundary", () => {
  it("only allowlisted files write to the documents table", () => {
    // packages/server is two levels up from this test file.
    const serverRoot = resolve(__dirname, "..", "..");
    const srcRoot = join(serverRoot, "src");
    const allowedAbs = new Set(ALLOWED_WRITER_PATHS.map((p) => join(serverRoot, p)));

    const offenders: string[] = [];
    for (const file of walkTs(srcRoot)) {
      if (allowedAbs.has(file)) continue;
      const rel = relative(srcRoot, file).split(sep).join("/");
      const body = readFileSync(file, "utf-8");
      if (WRITE_PATTERNS.some((re) => re.test(body))) offenders.push(rel);
    }

    expect(offenders).toEqual([]);
  });

  it("the allowlist paths all still exist (a stale entry hides nothing)", () => {
    const serverRoot = resolve(__dirname, "..", "..");
    const missing = ALLOWED_WRITER_PATHS.filter((p) => {
      try {
        statSync(join(serverRoot, p));
        return false;
      } catch {
        return true;
      }
    });
    expect(missing).toEqual([]);
  });

  it("sceneState still cannot name a contributed documentType", () => {
    // The load-bearing assumption behind allowing sync/sceneState.ts. If
    // someone teaches it to accept an arbitrary type, a pack entry becomes
    // writable over the socket and this allowlist entry becomes a hole.
    const serverRoot = resolve(__dirname, "..", "..");
    const body = readFileSync(join(serverRoot, "src/sync/sceneState.ts"), "utf-8");
    const literalTypes = [...body.matchAll(/type:\s*"([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(new Set(literalTypes)).toEqual(
      new Set(["square", "Folder", "Scene", "Setting", "Token"]),
    );
  });
});
