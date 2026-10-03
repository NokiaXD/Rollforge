import type { Database as DB } from "better-sqlite3";
import { type ExtensionManifest, type Document, SheetOwnerConflict } from "@rollforge/protocol";
import {
  type ServerExtensionAPI,
  type HooksEngine,
  type MigrationResult,
  freezeServerAPI,
  CommandRejection,
} from "@rollforge/extension-api";
import { validateManifest, CORE_VERSION } from "./manifest";
import {
  ChatCommandRegistry,
  DocumentTypeRegistry,
  MigrationRegistry,
  SheetRegistry,
} from "./registry";
import { MigrationLock } from "./migrationLock";
import { runDocumentMigrations, type RunMigrationsResult } from "../db/migrations-doc";
import type { DocumentStore } from "../db/documentStore";
import { createDiceAPI } from "./api/dice";

export type ExtensionState =
  | "Discovered"
  | "Validated"
  | "Registered"
  | "Active"
  | "Errored"
  | "Inactive"
  | "Incompatible";

export interface ExtensionEntry {
  manifest: ExtensionManifest;
  activate?: (api: ServerExtensionAPI) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
  root?: string | undefined;
}

export interface ContributedCommandMeta {
  name: string;
  description: string;
  requiredPermission: "GM" | "Player";
  extensionId: string;
}

export interface ExtensionRecord {
  id: string;
  state: ExtensionState;
  entry: ExtensionEntry;
  effectiveEvents: string[];
  error?: Error | undefined;
}

//  registerExtension never throws on a validation/contribution
// rejection — every rejection path returns { ok: false, reason } and leaves
// the extension in this.extensions as Incompatible. This matches validate-
// Manifest's structured-result shape and keeps the builtins loop and
// loadExtensions fault-tolerant: a single bad community extension cannot
// crash startup. Throws are reserved for programmer errors (no such case
// today; the try/catch in loadExtensions is belt-and-suspenders).
export type RegisterResult =
  | { ok: true; extensionId: string }
  | { ok: false; reason: string };

export interface ExtensionManagerOptions {
  coreVersion?: string | undefined;
  activationTimeoutMs?: number | undefined;
  hooks: HooksEngine;
  commandRegistry: ChatCommandRegistry;
  documentTypeRegistry?: DocumentTypeRegistry;
  migrationRegistry?: MigrationRegistry;
  migrationLock?: MigrationLock;
  sheetRegistry?: SheetRegistry;
  getUsersAPI?: (() => ServerExtensionAPI["users"]) | undefined;
  // Internal subset: the host wires get/create/update/delete against its
  // DocumentStore. registerMigrations is owned by the manager itself and
  // routes to the MigrationRegistry — see createScopedAPI.
  getDocumentsAPI?: (() => Pick<
    ServerExtensionAPI["documents"],
    "get" | "create" | "update" | "delete"
  >) | undefined;
  getDocumentStore?: (() => any) | undefined;
  getDocumentDb?: (() => DB | null) | undefined;
  getChatSendHandler?: (() => ServerExtensionAPI["chat"]["send"]) | undefined;
}

export class ExtensionManager {
  private extensions = new Map<string, ExtensionRecord>();
  private contributedCommands = new Map<string, ContributedCommandMeta>();
  private activationPromises = new Map<string, Promise<void>>();
  private generations = new Map<string, number>();

  public readonly coreVersion: string;
  public readonly timeoutMs: number;
  public readonly hooks: HooksEngine;
  public readonly commandRegistry: ChatCommandRegistry;
  public readonly documentTypeRegistry: DocumentTypeRegistry;
  public readonly migrationRegistry: MigrationRegistry;
  public readonly migrationLock: MigrationLock;
  public readonly sheetRegistry: SheetRegistry;
  private getUsersAPI?: (() => ServerExtensionAPI["users"]) | undefined;
  private getDocumentsAPI?: (() => Pick<
    ServerExtensionAPI["documents"],
    "get" | "create" | "update" | "delete"
  >) | undefined;
  private getDocumentStore?: (() => any) | undefined;
  private getDocumentDb?: (() => DB | null) | undefined;
  private getChatSendHandler?: (() => ServerExtensionAPI["chat"]["send"]) | undefined;

  constructor(options: ExtensionManagerOptions) {
    this.coreVersion = options.coreVersion ?? CORE_VERSION;
    this.timeoutMs = options.activationTimeoutMs ?? 5000;
    this.hooks = options.hooks;
    this.commandRegistry = options.commandRegistry;
    this.documentTypeRegistry = options.documentTypeRegistry ?? new DocumentTypeRegistry();
    this.migrationRegistry = options.migrationRegistry ?? new MigrationRegistry();
    this.migrationLock = options.migrationLock ?? new MigrationLock();
    this.sheetRegistry =
      options.sheetRegistry ??
      new SheetRegistry({
        getDocumentTypeOwner: (dt) => this.documentTypeRegistry.get(dt)?.extensionId,
      });
    this.getUsersAPI = options.getUsersAPI;
    this.getDocumentsAPI = options.getDocumentsAPI;
    this.getDocumentStore = options.getDocumentStore;
    this.getDocumentDb = options.getDocumentDb;
    this.getChatSendHandler = options.getChatSendHandler;
  }

  registerExtension(entry: ExtensionEntry): RegisterResult {
    const val = validateManifest(entry.manifest, this.coreVersion);
    if (!val.ok || !val.manifest || !val.effectiveEvents) {
      const reason = val.error ?? "Invalid extension manifest";
      this.recordIncompatible(entry, new Error(reason));
      return { ok: false, reason };
    }

    const id = val.manifest.id;
    if (this.extensions.has(id)) {
      const reason = `Extension "${id}" is already registered`;
      this.recordIncompatible(entry, new Error(reason));
      return { ok: false, reason };
    }

    const result = this.applyContributions(val.manifest, entry);
    if (!result.ok) return result;

    const record: ExtensionRecord = {
      id,
      state: "Registered",
      entry,
      effectiveEvents: val.effectiveEvents,
    };
    this.extensions.set(id, record);
    return { ok: true, extensionId: id };
  }

  //  extracted so retryExtension can re-apply declarative
  // contributions after a deactivate → state=Registered round-trip without
  // bouncing through validateManifest again. Idempotent for the same
  // extension id — same-entry re-registration after a failed activate is
  // the normal retry path.
  private applyContributions(
    manifest: ExtensionManifest,
    entry: ExtensionEntry,
  ): RegisterResult {
    const id = manifest.id;
    const addedCommandNames = new Set<string>();
    if (manifest.contributes?.chatCommands) {
      for (const cmd of manifest.contributes.chatCommands) {
        const cmdName = cmd.name.toLowerCase();
        const existing = this.contributedCommands.get(cmdName);
        if (existing && existing.extensionId !== id) {
          const reason = `Chat command "${cmdName}" contributed by "${id}" conflicts with extension "${existing.extensionId}"`;
          this.recordIncompatible(entry, new Error(reason));
          this.rollbackContributions(id, addedCommandNames);
          return { ok: false, reason };
        }
        this.contributedCommands.set(cmdName, {
          name: cmdName,
          description: cmd.description,
          requiredPermission: cmd.requiredPermission ?? "Player",
          extensionId: id,
        });
        addedCommandNames.add(cmdName);
      }
    }
    if (manifest.contributes?.documentTypes) {
      for (const dt of manifest.contributes.documentTypes) {
        const existing = this.documentTypeRegistry.get(dt.id);
        if (existing) {
          if (existing.extensionId === id) {
            // Same extension re-registering (retry path); the registry
            // already holds the entry. Skip.
            continue;
          }
          const reason = `documentType "${dt.id}" is already contributed by extension "${existing.extensionId}"`;
          this.recordIncompatible(entry, new Error(reason));
          this.rollbackContributions(id, addedCommandNames);
          return { ok: false, reason };
        }
        try {
          this.documentTypeRegistry.register(dt, id);
        } catch (err) {
          const reason = `documentType "${dt.id}" could not be registered by "${id}": ${err instanceof Error ? err.message : String(err)}`;
          this.recordIncompatible(entry, err instanceof Error ? err : new Error(reason));
          this.rollbackContributions(id, addedCommandNames);
          return { ok: false, reason };
        }
      }
    }
    if (manifest.contributes?.sheets) {
      for (const sh of manifest.contributes.sheets) {
        try {
          this.sheetRegistry.register(sh, id);
        } catch (err) {
          if (err instanceof SheetOwnerConflict) {
            // The previous default has been restored by unregisterAll; let
            // the registration proceed if the owner matches this extension.
            const ownerId =
              this.documentTypeRegistry.get(sh.documentType)?.extensionId;
            if (ownerId === id) continue;
          }
          const reason = `sheet for "${sh.documentType}" could not be registered by "${id}": ${err instanceof Error ? err.message : String(err)}`;
          this.recordIncompatible(entry, err instanceof Error ? err : new Error(reason));
          this.rollbackContributions(id, addedCommandNames);
          return { ok: false, reason };
        }
      }
    }
    return { ok: true, extensionId: id };
  }

  private recordIncompatible(entry: ExtensionEntry, err: Error): void {
    const record: ExtensionRecord = {
      id: entry.manifest?.id ?? "unknown",
      state: "Incompatible",
      entry,
      effectiveEvents: [],
      error: err,
    };
    this.extensions.set(record.id, record);
  }

  private rollbackContributions(extensionId: string, addedCommandNames: Set<string>): void {
    for (const name of addedCommandNames) {
      this.contributedCommands.delete(name);
    }
    this.documentTypeRegistry.unregisterAll(extensionId);
    this.sheetRegistry.unregisterAll(extensionId);
  }

  private clearContributions(extensionId: string): void {
    for (const [name, meta] of this.contributedCommands.entries()) {
      if (meta.extensionId === extensionId) {
        this.contributedCommands.delete(name);
      }
    }
    this.documentTypeRegistry.unregisterAll(extensionId);
    this.migrationRegistry.unregisterAll(extensionId);
    this.sheetRegistry.unregisterAll(extensionId);
  }

  private async runEagerMigrations(ext: ExtensionRecord): Promise<void> {
    const db = this.getDocumentDb?.();
    const store = this.getDocumentStore?.();
    if (!db || !store) return;

    const chains = this.migrationRegistry.list().filter(
      (c) => c.extensionId === ext.id,
    );
    for (const reg of chains) {
      // Paso 18: un documentType con scope "compendium" NO se migra al
      // activar. Un pack son miles de entradas y §12 las quiere lazy (al
      // abrir cada una). Sus documentos migran vía migrateIfStale, que es
      // idempotente: el eager no aportaría nada, sólo movería el coste al
      // arranque, que es justo lo que §12 quiere evitar.
      if (this.documentTypeRegistry.get(reg.type)?.type.scope === "compendium") {
        continue;
      }
      const docs = (store.getByType as (t: string) => Array<any>)(reg.type);
      for (const doc of docs) {
        //  Fast path ONLY — an optimization, not a correctness gate. The
        //  authoritative staleness check happens inside migrateDocument,
        //  under the lock. This check reads a snapshot taken outside the
        //  lock, so a concurrent lazy read (migrateIfStale) could migrate
        //  this document after we read it; deciding from this stale
        //  snapshot and then running the chain on a stale document is the
        //  double-migration bug that lazy migration made reachable.
        if (doc.schemaVersion >= reg.targetVersion) continue;
        const result = await this.migrateDocument(doc.id);
        if (!result.ok) {
          console.warn(
            `[migrations] ext=${ext.id} doc=${doc.id} type=${reg.type} v${result.atFrom}->v${result.atTo} blocked: ${result.error}`,
          );
        }
      }
    }
  }

  getExtension(id: string): ExtensionRecord | undefined {
    return this.extensions.get(id);
  }

  list(): ExtensionRecord[] {
    return Array.from(this.extensions.values());
  }

  getContributedCommand(name: string): ContributedCommandMeta | undefined {
    return this.contributedCommands.get(name.toLowerCase());
  }

  canInvoke(commandName: string, role: "GM" | "Player"): boolean {
    const meta = this.contributedCommands.get(commandName.toLowerCase());
    if (!meta) return true;
    if (meta.requiredPermission === "GM" && role !== "GM") {
      return false;
    }
    return true;
  }

  async ensureActivated(id: string): Promise<void> {
    const ext = this.extensions.get(id);
    if (!ext) {
      throw new Error(`Unknown extension "${id}"`);
    }
    if (ext.state === "Active") {
      return;
    }
    if (ext.state === "Errored") {
      throw new Error(`Extension "${id}" is in Errored state`);
    }

    const existingPromise = this.activationPromises.get(id);
    if (existingPromise) {
      return existingPromise;
    }

    const p = this.doActivate(ext);
    this.activationPromises.set(id, p);
    try {
      await p;
    } finally {
      this.activationPromises.delete(id);
    }
  }

  private async doActivate(ext: ExtensionRecord): Promise<void> {
    const currentGen = (this.generations.get(ext.id) ?? 0) + 1;
    this.generations.set(ext.id, currentGen);

    const isGenerationValid = () =>
      this.generations.get(ext.id) === currentGen &&
      ext.state !== "Errored" &&
      ext.state !== "Inactive";

    const scopedApi = this.createScopedAPI(ext.id, isGenerationValid);

    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Extension "${ext.id}" activation timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });

    try {
      if (ext.entry.activate) {
        await Promise.race([
          Promise.resolve(ext.entry.activate(scopedApi)),
          timeoutPromise,
        ]);
      }
      if (timer) clearTimeout(timer);
      // Eager migration runs after activate() so the extension can call
      // api.documents.registerMigrations during activation. Per Paso 15
      // design: blocked docs do not fail activation — only activate()
      // throwing or chain-shape errors escalate to Errored.
      await this.runEagerMigrations(ext);
      ext.state = "Active";
      ext.error = undefined;
    } catch (err: any) {
      if (timer) clearTimeout(timer);
      ext.state = "Errored";
      ext.error = err instanceof Error ? err : new Error(String(err));
      this.generations.set(ext.id, currentGen + 1); // invalidate generation
      this.hooks.clear(ext.id);
      this.commandRegistry.unregisterAll(ext.id);
      throw err;
    }
  }

  async retryExtension(id: string): Promise<void> {
    const ext = this.extensions.get(id);
    if (!ext) {
      throw new Error(`Unknown extension "${id}"`);
    }
    // Re-apply declarative contributions cleared by deactivate so the
    // extension can registerMigrations against its own types again. Runtime
    // state (hooks, commands) stays clear until activate() re-populates it.
    const reapplied = this.applyContributions(ext.entry.manifest, ext.entry);
    if (!reapplied.ok) {
      ext.state = "Incompatible";
      ext.error = new Error(reapplied.reason);
      throw new Error(reapplied.reason);
    }
    ext.state = "Registered";
    ext.error = undefined;
    await this.ensureActivated(id);
  }

  async deactivateExtension(id: string): Promise<void> {
    const ext = this.extensions.get(id);
    if (!ext) return;

    const currentGen = (this.generations.get(id) ?? 0) + 1;
    this.generations.set(id, currentGen); // invalidate generation

    try {
      if (ext.entry.deactivate) {
        await ext.entry.deactivate();
      }
    } catch (err) {
      console.error(`[ExtensionManager] Error deactivating extension "${id}":`, err);
    } finally {
      ext.state = "Inactive";
      this.hooks.clear(id);
      this.commandRegistry.unregisterAll(id);
      this.clearContributions(id);
    }
  }

  async dispatchActivationEvent(event: string): Promise<void> {
    const activations: Promise<void>[] = [];
    for (const ext of this.extensions.values()) {
      if (ext.effectiveEvents.includes(event)) {
        activations.push(this.ensureActivated(ext.id));
      }
    }
    await Promise.allSettled(activations);
  }

  private createScopedAPI(
    extensionId: string,
    isGenerationValid: () => boolean
  ): ServerExtensionAPI {
    const hooks: ServerExtensionAPI["hooks"] = {
      on: (evt, handler) => {
        if (!isGenerationValid()) return () => {};
        return this.hooks.on(evt, handler, { ownerId: extensionId });
      },
      filter: (evt, handler, opts) => {
        if (!isGenerationValid()) return () => {};
        return this.hooks.filter(evt, handler, {
          priority: opts?.priority ?? 0,
          ownerId: extensionId,
        });
      },
      off: (evt, handler) => {
        this.hooks.off(evt, handler);
      },
    };

    const chat: ServerExtensionAPI["chat"] = {
      send: async (msg, opts) => {
        if (this.getChatSendHandler) {
          await this.getChatSendHandler()(msg, opts);
        }
      },
      registerCommand: (cmd) => {
        if (!isGenerationValid()) return;
        this.commandRegistry.register({
          name: cmd.name,
          description: cmd.description,
          handler: cmd.handler,
          requiredPermission: cmd.requiredPermission ?? "Player",
          extensionId,
        });
      },
    };

    const dice = createDiceAPI(this.hooks, extensionId, this.getDocumentStore);

    const users: ServerExtensionAPI["users"] = {
      findByName: (name) => {
        if (this.getUsersAPI) {
          return this.getUsersAPI().findByName(name);
        }
        return null;
      },
    };

    const documents: ServerExtensionAPI["documents"] = {
      // Lazy migration on read (§12): a compendium entry is migrated when
      // it is first inspected/imported, not when the extension activates.
      get: async <T extends Document = Document>(id: string): Promise<T | null> => {
        if (this.getDocumentStore) {
          return (await this.migrateIfStale<T>(id)) ?? null;
        }
        return this.getDocumentsAPI ? this.getDocumentsAPI().get<T>(id) : null;
      },
      create: async (input) => {
        if (!this.getDocumentsAPI) throw new Error("Document API not available");
        // Paso 15 gate: writes for a contributed type are blocked while the
        // contributing extension isn't Active. Throwing with a typed Error
        // so extensions can catch and surface the reason.
        if (!this.isTypeReady(input.type)) {
          throw new DocumentGateError("extension-not-ready", input.type);
        }
        return this.getDocumentsAPI().create(input);
      },
      update: async (id, patch) => {
        if (!this.getDocumentsAPI) throw new Error("Document API not available");
        const existing = await this.getDocumentsAPI().get(id);
        if (!existing) throw new Error(`Document ${id} not found`);
        if (!this.isTypeReady(existing.type)) {
          throw new DocumentGateError("extension-not-ready", existing.type);
        }
        if (existing.migrationStatus === "blocked") {
          throw new DocumentGateError("migration-blocked", existing.type, id);
        }
        return this.getDocumentsAPI().update(id, patch);
      },
      delete: async (id) => {
        if (!this.getDocumentsAPI) throw new Error("Document API not available");
        return this.getDocumentsAPI().delete(id);
      },
      registerMigrations: (documentType, chain) => {
        if (!isGenerationValid()) {
          return { ok: false, reason: "extension-not-active" };
        }
        // Ownership: chain must be for a type this extension contributed.
        // This prevents one extension from registering migrations for a
        // competitor's documentType.
        const owner = this.documentTypeRegistry.get(documentType)?.extensionId;
        if (owner !== extensionId) {
          return {
            ok: false,
            reason:
              owner === undefined
                ? `documentType "${documentType}" is not contributed by this extension`
                : `documentType "${documentType}" is owned by "${owner}", not "${extensionId}"`,
          };
        }
        const target = this.documentTypeRegistry.get(documentType)?.type.schemaVersion;
        if (target === undefined) {
          return { ok: false, reason: `documentType "${documentType}" has no schemaVersion` };
        }
        return this.migrationRegistry.register(documentType, chain as any, target, extensionId);
      },
    };

    const migrations: ServerExtensionAPI["migrations"] = {
      listBlocked: async () => {
        const db = this.getDocumentDb?.();
        if (!db) return [];
        return db
          .prepare(
            `SELECT doc_id as docId, doc_type as docType, prev_version as prevVersion, created_at as createdAt
             FROM document_migration_snapshots
             WHERE status = 'failed'
             ORDER BY created_at DESC
             LIMIT 50`,
          )
          .all() as Array<{
            docId: string;
            docType: string;
            prevVersion: number;
            createdAt: number;
          }>;
      },
      retry: async (docId) => this.migrateDocument(docId, {}),
      review: async (docId, patch) =>
        this.migrateDocument(docId, {
          skipSteps: new Set(patch.skipSteps),
          ...(patch.systemOverride !== undefined
            ? { systemOverride: patch.systemOverride }
            : {}),
        }),
    };

    const api: ServerExtensionAPI = {
      documents,
      hooks,
      chat,
      dice,
      users,
      migrations,
      context: { extensionId },
      errors: { CommandRejection },
    };

    return freezeServerAPI(api);
  }

  // Exposed publicly so documentsGate.ts can delegate to this single source
  // of truth. Both the extension API path (createScopedAPI) and the HTTP
  // route path (documentRoutes via documentsGate) use the same check.
  isTypeReady(type: string): boolean {
    const ownerId = this.documentTypeRegistry.get(type)?.extensionId;
    if (!ownerId) return true;
    return this.extensions.get(ownerId)?.state === "Active";
  }

  //  Shared body of retry/review/inspect. Serialized per-DOCUMENT via
  //  MigrationLock (§12) so a manual retry from /migrations, the eager loop
  //  and a lazy read can't interleave on the same doc — and so two users
  //  opening the same compendium entry share one migration instead of
  //  duplicating the work. Different documents run in parallel.
  //
  //  The read happens INSIDE the lock, and that is load-bearing: a caller
  //  that read the document before queueing is holding a snapshot that
  //  another caller may have just migrated. Passing that stale snapshot to
  //  runDocumentMigrations makes its "already at target?" check see the old
  //  version and re-run the whole chain over the fresh data — which is
  //  exactly the double migration the lock exists to prevent. The Paso 15
  //  code had this read outside the lock; it only became observable once a
  //  second concurrent path (lazy read) existed.
  async migrateDocument(
    docId: string,
    opts: { skipSteps?: Set<number>; systemOverride?: unknown } = {},
  ): Promise<MigrationResult> {
    const db = this.getDocumentDb?.();
    const store = this.getDocumentStore?.() as DocumentStore | undefined;
    if (!db || !store) {
      return { ok: false, atFrom: 0, atTo: 0, error: "document store unavailable" };
    }
    let result: RunMigrationsResult | undefined;
    // Early exits have to cross the lock boundary, so they travel as flags
    // resolved after it rather than as returns from inside the critical
    // section.
    let missing = false;
    let noChain: { version: number; type: string } | undefined;

    await this.migrationLock.runExclusive(docId, async () => {
      const doc = store.getById(docId);
      if (!doc) {
        missing = true;
        return;
      }
      const reg = this.migrationRegistry.get(doc.type);
      if (!reg) {
        noChain = { version: doc.schemaVersion, type: doc.type };
        return;
      }
      // Same cast and the same reasoning as the eager loop: the chain was
      // registered by an extension that typed it against ITS TSystem, and the
      // registry erases that at runtime. It is sound because the extension
      // owns the documentType, and registerMigrations refuses a chain for a
      // type it does not own.
      result = await runDocumentMigrations(
        db,
        doc as any,
        reg.chain as any,
        reg.targetVersion,
        opts,
      );
    });

    if (missing) {
      return { ok: false, atFrom: 0, atTo: 0, error: `Document ${docId} not found` };
    }
    if (noChain) {
      return {
        ok: false,
        atFrom: noChain.version,
        atTo: noChain.version,
        error: `No migration chain registered for documentType "${noChain.type}"`,
      };
    }
    if (!result) {
      const v = store.getById(docId)?.schemaVersion ?? 0;
      return { ok: false, atFrom: v, atTo: v, error: "lock failed" };
    }
    if (result.ok) {
      return { ok: true, fromVersion: result.fromVersion, toVersion: result.toVersion };
    }
    return {
      ok: false,
      atFrom: result.atFrom,
      atTo: result.atTo,
      error: result.error.message,
    };
  }

  //  The declared schemaVersion of a documentType — the single source of
  //  truth for "current", per §12 ("no está hardcodeada en ningún otro
  //  sitio — es el schemaVersion que la extensión ya declara en
  //  contributes.documentTypes"). DocumentStore's resolver and the import
  //  route both read it from here instead of touching the registry
  //  themselves, so there is one definition, not two that can drift.
  currentSchemaVersion(type: string): number | undefined {
    return this.documentTypeRegistry.get(type)?.type.schemaVersion;
  }

  //  Lazy migration trigger (§12): "entradas de compendio: lazy, al abrir
  //  cada una". Called from the two read paths that mean "the user is about
  //  to look at this document" — api.documents.get and GET /:id — plus the
  //  import route, which needs the source at its target version.
  //
  //  Returns the document to serve, NOT a MigrationResult: a failed
  //  migration is not an error for the reader. §15/Paso 15 fix that a broken
  //  chain blocks the document (migration_status='blocked' + snapshot) and
  //  leaves the extension Active; the reader gets the partially-migrated doc
  //  with that flag, and writes stay blocked by the existing 409 gate. Only
  //  a missing document is null.
  async migrateIfStale<T extends Document = Document>(
    docId: string,
  ): Promise<T | null> {
    const store = this.getDocumentStore?.() as DocumentStore | undefined;
    if (!store) return null;
    const before = store.getById(docId) as T | null;
    if (!before) return null;
    // No chain registered (base types like "Actor") → nothing to migrate.
    const reg = this.migrationRegistry.get(before.type);
    if (!reg) return before;
    if (before.schemaVersion >= reg.targetVersion) return before;
    await this.migrateDocument(docId);
    // Re-read: the runner writes the migrated system + version straight to
    // SQLite, so the pre-migration snapshot we started from is stale.
    return (store.getById(docId) as T | null) ?? before;
  }
}

//  typed error so the extension / route layer can distinguish gate
// failures from programmer errors. Reason + offending type or id flows
// through to whichever consumer called into the API.
export class DocumentGateError extends Error {
  constructor(
    public readonly reason: "extension-not-ready" | "migration-blocked",
    public readonly docType: string,
    public readonly docId?: string,
  ) {
    super(reason);
    this.name = "DocumentGateError";
  }
}
