import type { Document, Folder, FolderSystem, OwnershipLevel, SceneSystem } from "@rollforge/protocol";
import type { DocumentStore } from "../db/documentStore";

export type TokenOwnership = Record<string, OwnershipLevel> & { default?: OwnershipLevel };

export interface TokenSystem {
  sceneId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TokenRecord {
  id: string;
  sceneId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  ownership: TokenOwnership;
  _rev: number;
  /** userId of the player who owns this token; undefined = GM-only */
  ownerId?: string;
  /**
   *  The token's own image. Deliberately standalone: there is no Token→Actor link
   *  yet, so there is nothing to inherit from. Adding `actorId` later is a design
   *  decision, not a side effect of this field.
   */
  img?: string;
}

export interface DragLock {
  ownerId: string;
  expiresAt: number;
}

const DEFAULT_LOCK_TTL_MS = 5000;

export type SceneDoc = Document<SceneSystem>;
export type FolderDoc = Document<FolderSystem>;

export const ACTIVE_SCENE_DOC_ID = "active-scene";

export interface ActiveSceneSystem {
  sceneId: string;
}
export type ActiveSceneDoc = Document<ActiveSceneSystem>;

function defaultSceneSystem(): SceneSystem {
  return {
    width: 25000,
    height: 25000,
    background: null,
    grid: { size: 50, color: 0x2c313a, type: "square" },
    cellLength: 5,
    units: "ft",
  };
}

export interface SceneStateOpts {
  store?: DocumentStore | undefined;
}

export class SceneState {
  private tokens = new Map<string, TokenRecord>();
  private locks = new Map<string, DragLock>();
  private scenes = new Map<string, SceneDoc>();
  private folders = new Map<string, FolderDoc>();
  private readonly store: DocumentStore | undefined;
  private activeSceneId: string = "default";

  constructor(opts: SceneStateOpts = {}) {
    this.store = opts.store;
    if (this.store) this.hydrate();
    this.ensureDefaultScene();
  }

  getActiveSceneId(): string {
    return this.activeSceneId;
  }

  setActiveSceneId(id: string): void {
    if (typeof id === "string" && id.length > 0) {
      this.activeSceneId = id;
      this.persistActiveScene(id);
    }
  }

  getScene(id: string): SceneDoc | undefined {
    return this.scenes.get(id);
  }

  listScenes(): SceneDoc[] {
    return [...this.scenes.values()];
  }

  private hydrate(): void {
    if (!this.store) return;
    for (const doc of this.store.getByType<TokenSystem>("Token")) {
      this.tokens.set(doc.id, {
        id: doc.id,
        sceneId: doc.system.sceneId,
        x: doc.system.x,
        y: doc.system.y,
        w: doc.system.w,
        h: doc.system.h,
        ownership: doc.ownership,
        _rev: doc._rev,
        ...(doc.img !== undefined ? { img: doc.img } : {}),
      });
    }
    for (const doc of this.store.getByType<SceneSystem>("Scene")) {
      this.scenes.set(doc.id, doc);
    }
    for (const doc of this.store.getByType<FolderSystem>("Folder")) {
      this.folders.set(doc.id, doc);
    }
    const activeDoc = this.store.getById<ActiveSceneSystem>(ACTIVE_SCENE_DOC_ID);
    if (activeDoc && typeof activeDoc.system?.sceneId === "string") {
      this.activeSceneId = activeDoc.system.sceneId;
    }
  }

  private ensureDefaultScene(): void {
    if (!this.scenes.has("default")) {
      const doc = this.makeSceneDoc("default", "Default", defaultSceneSystem());
      this.scenes.set("default", doc);
      this.store?.save(doc);
    }
    if (!this.scenes.has(this.activeSceneId)) {
      this.activeSceneId = "default";
      this.persistActiveScene("default");
    }
  }

  createScene(sceneId: string, name: string, system: SceneSystem, img?: string | null, folder?: string | null): SceneDoc {
    if (this.scenes.has(sceneId)) throw new Error(`scene ${sceneId} already exists`);
    const doc = this.makeSceneDoc(sceneId, name, system, img, folder);
    this.scenes.set(sceneId, doc);
    this.store?.save(doc);
    return doc;
  }

  updateScene(sceneId: string, name: string, system: SceneSystem, img?: string | null, folder?: string | null): SceneDoc | null {
    const existing = this.scenes.get(sceneId);
    if (!existing) return null;
    existing.name = name || sceneId;
    existing.system = { ...system, folder: folder ?? system.folder ?? null };
    if (img !== undefined) {
      if (img === null) delete existing.img;
      else existing.img = img;
    }
    existing._rev += 1;
    if (this.store) this.store.update(existing, existing._rev - 1);
    return existing;
  }

  deleteScene(sceneId: string): boolean {
    const existing = this.scenes.get(sceneId);
    if (!existing) return false;
    this.scenes.delete(sceneId);
    this.store?.delete(sceneId);
    if (this.activeSceneId === sceneId) {
      this.setActiveSceneId("default");
    }
    return true;
  }

  //  order is a midpoint between its neighbours, never index*1000: reordering used to
  //  assign a colliding order to the moved scene and it snapped back on the next reload.
  //   gaps halve on every insert; re-number the list when one hits 0.
  moveScene(sceneId: string, folder: string | null, index: number): SceneDoc | null {
    const scene = this.scenes.get(sceneId);
    if (!scene) return null;
    if (folder !== null && !this.folders.has(folder)) return null;
    if (!Number.isFinite(index) || index < 0) return null;
    // index is relative to the destination list *without* the moving scene
    const list = this.listScenes()
      .filter((s) => (s.system.folder ?? null) === folder && s.id !== sceneId)
      .sort((a, b) => (a.system.order ?? 0) - (b.system.order ?? 0) || a.id.localeCompare(b.id));
    const at = Math.min(Math.trunc(index), list.length);
    const prev = at > 0 ? list[at - 1]?.system.order ?? 0 : null;
    const next = at < list.length ? list[at]?.system.order ?? 0 : null;
    const lo = prev ?? (next ?? 0) - 1000;
    const hi = next ?? lo + 1000;
    scene.system.folder = folder;
    scene.system.order = at < list.length ? Math.floor((lo + hi) / 2) : hi;
    scene._rev += 1;
    if (this.store) this.store.update(scene, scene._rev - 1);
    return scene;
  }

  getFolder(id: string): FolderDoc | undefined {
    return this.folders.get(id);
  }

  listFolders(): FolderDoc[] {
    return [...this.folders.values()];
  }

  createFolder(folderId: string, name: string): FolderDoc {
    if (this.folders.has(folderId)) throw new Error(`folder ${folderId} already exists`);
    const doc: FolderDoc = {
      id: folderId,
      type: "Folder",
      name: name || folderId,
      system: {},
      flags: {},
      ownership: { default: "LIMITED" },
      schemaVersion: 0,
      migrationStatus: "ok",
      _rev: 0,
    };
    this.folders.set(folderId, doc);
    this.store?.save(doc);
    return doc;
  }

  updateFolder(folderId: string, name: string): FolderDoc | null {
    const existing = this.folders.get(folderId);
    if (!existing) return null;
    existing.name = name || folderId;
    existing._rev += 1;
    if (this.store) this.store.update(existing, existing._rev - 1);
    return existing;
  }

  // Flat folders — delete orphans scenes pointing at the folder and removes it.
  deleteFolder(folderId: string): { deletedFolders: string[]; orphanedScenes: SceneDoc[] } {
    const root = this.folders.get(folderId);
    if (!root) return { deletedFolders: [], orphanedScenes: [] };
    const orphanedScenes: SceneDoc[] = [];
    for (const scene of [...this.scenes.values()]) {
      if (scene.system.folder === folderId) {
        scene.system.folder = null;
        scene._rev += 1;
        if (this.store) this.store.update(scene, scene._rev - 1);
        orphanedScenes.push(scene);
      }
    }
    this.folders.delete(folderId);
    this.store?.delete(folderId);
    return { deletedFolders: [folderId], orphanedScenes };
  }

  private makeSceneDoc(sceneId: string, name: string, system: SceneSystem, img?: string | null, folder?: string | null): SceneDoc {
    const doc: SceneDoc = {
      id: sceneId,
      type: "Scene",
      name: name || sceneId,
      system: { ...system, folder: folder ?? system.folder ?? null },
      flags: {},
      ownership: { default: "LIMITED" },
      schemaVersion: 0,
      migrationStatus: "ok",
      _rev: 0,
    };
    if (img) doc.img = img;
    return doc;
  }

  createToken(
    id: string,
    sceneId: string,
    x = 0,
    y = 0,
    w = 1,
    h = 1,
    ownership: TokenOwnership = { default: "LIMITED" },
  ): TokenRecord {
    const token: TokenRecord = { id, sceneId, x, y, w, h, ownership, _rev: 0 };
    this.tokens.set(id, token);
    this.persistCreate(token);
    return token;
  }

  ensureScene(sceneId: string, tokens: Pick<TokenRecord, "id" | "x" | "y">[] = []): TokenRecord[] {
    return tokens.map((t) => this.createToken(t.id, sceneId, t.x, t.y));
  }

  getToken(id: string): TokenRecord | undefined {
    return this.tokens.get(id);
  }

  getSceneTokens(sceneId: string): TokenRecord[] {
    return [...this.tokens.values()].filter((t) => t.sceneId === sceneId);
  }

  //  drops the token and any lock on it. Persistence follows the scene/folder pattern:
  //  SceneState owns token rows, the store is just the durable mirror.
  deleteToken(tokenId: string): boolean {
    if (!this.tokens.delete(tokenId)) return false;
    this.locks.delete(tokenId);
    this.store?.delete(tokenId);
    return true;
  }

  acquireLock(tokenId: string, ownerId: string, ttlMs = DEFAULT_LOCK_TTL_MS): DragLock | null {
    this.expireLocks();
    const existing = this.locks.get(tokenId);
    if (existing && existing.ownerId !== ownerId) return null;
    const lock: DragLock = { ownerId, expiresAt: Date.now() + ttlMs };
    this.locks.set(tokenId, lock);
    return lock;
  }

  releaseLock(tokenId: string, ownerId: string): boolean {
    const existing = this.locks.get(tokenId);
    if (!existing || existing.ownerId !== ownerId) return false;
    this.locks.delete(tokenId);
    return true;
  }

  releaseAllFor(ownerId: string): string[] {
    const released: string[] = [];
    for (const [tokenId, lock] of this.locks) {
      if (lock.ownerId === ownerId) {
        this.locks.delete(tokenId);
        released.push(tokenId);
      }
    }
    return released;
  }

  getLock(tokenId: string): DragLock | undefined {
    return this.locks.get(tokenId);
  }

  // optimistic _rev check + lock ownership in one place. All MoveToken paths route here.
  moveToken(
    tokenId: string,
    ownerId: string,
    x: number,
    y: number,
    expectedRev: number,
  ): TokenRecord | null {
    this.expireLocks();
    const token = this.tokens.get(tokenId);
    if (!token) return null;
    if (token._rev !== expectedRev) return null;
    const lock = this.locks.get(tokenId);
    if (lock && lock.ownerId !== ownerId) return null;
    token.x = x;
    token.y = y;
    token._rev += 1;
    this.persistUpdate(token);
    return token;
  }

  private persistCreate(token: TokenRecord): void {
    this.store?.save(this.toDoc(token));
  }

  private persistUpdate(token: TokenRecord): void {
    this.store?.update(this.toDoc(token), token._rev - 1);
  }

  private persistActiveScene(id: string): void {
    if (!this.store) return;
    const existing = this.store.getById<ActiveSceneSystem>(ACTIVE_SCENE_DOC_ID);
    if (existing) {
      existing.system = { sceneId: id };
      this.store.update(existing, existing._rev);
    } else {
      const doc: Document<ActiveSceneSystem> = {
        id: ACTIVE_SCENE_DOC_ID,
        type: "Setting",
        name: "Active Scene",
        system: { sceneId: id },
        flags: {},
        ownership: { default: "LIMITED" },
        schemaVersion: 0,
        migrationStatus: "ok",
        _rev: 0,
      };
      this.store.save(doc);
    }
  }

  //  Reconstructs the whole doc on every write, so any Document field not listed
  //  here is silently erased by the next MoveToken. `img` is carried explicitly
  //  for that reason — see the "unrelated mutation preserves untouched fields" test.
  private toDoc(token: TokenRecord): Document<TokenSystem> {
    const doc: Document<TokenSystem> = {
      id: token.id,
      type: "Token",
      name: token.id,
      system: {
        sceneId: token.sceneId,
        x: token.x,
        y: token.y,
        w: token.w,
        h: token.h,
      },
      flags: {},
      ownership: token.ownership,
      schemaVersion: 0,
      migrationStatus: "ok",
      _rev: token._rev,
    };
    if (token.img) doc.img = token.img;
    return doc;
  }

  private expireLocks(): void {
    const now = Date.now();
    for (const [tokenId, lock] of this.locks) {
      if (lock.expiresAt <= now) this.locks.delete(tokenId);
    }
  }
}

export type TokenDoc = Document<{ x: number; y: number; sceneId: string }>;
