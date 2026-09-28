import type { Document, OwnershipLevel, SceneSystem } from "@rollforge/protocol";
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
}

export interface DragLock {
  ownerId: string;
  expiresAt: number;
}

const DEFAULT_LOCK_TTL_MS = 5000;

export type SceneDoc = Document<SceneSystem>;

function defaultSceneSystem(): SceneSystem {
  return {
    width: 25000,
    height: 25000,
    background: null,
    grid: { size: 50, color: 0x2c313a, type: "square" },
  };
}

export interface SceneStateOpts {
  store?: DocumentStore | undefined;
}

export class SceneState {
  private tokens = new Map<string, TokenRecord>();
  private locks = new Map<string, DragLock>();
  private scenes = new Map<string, SceneDoc>();
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
    if (typeof id === "string" && id.length > 0) this.activeSceneId = id;
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
      });
    }
    for (const doc of this.store.getByType<SceneSystem>("Scene")) {
      this.scenes.set(doc.id, doc);
    }
  }

  private ensureDefaultScene(): void {
    if (this.scenes.has("default")) return;
    const doc = this.makeSceneDoc("default", "Default", defaultSceneSystem());
    this.scenes.set("default", doc);
    this.store?.save(doc);
  }

  createScene(sceneId: string, name: string, system: SceneSystem): SceneDoc {
    if (this.scenes.has(sceneId)) throw new Error(`scene ${sceneId} already exists`);
    const doc = this.makeSceneDoc(sceneId, name, system);
    this.scenes.set(sceneId, doc);
    this.store?.save(doc);
    return doc;
  }

  updateScene(sceneId: string, name: string, system: SceneSystem): SceneDoc | null {
    const existing = this.scenes.get(sceneId);
    if (!existing) return null;
    existing.name = name || sceneId;
    existing.system = system;
    existing._rev += 1;
    if (this.store) this.store.update(existing, existing._rev - 1);
    return existing;
  }

  deleteScene(sceneId: string): boolean {
    const existing = this.scenes.get(sceneId);
    if (!existing) return false;
    this.scenes.delete(sceneId);
    this.store?.delete(sceneId);
    return true;
  }

  private makeSceneDoc(sceneId: string, name: string, system: SceneSystem): SceneDoc {
    return {
      id: sceneId,
      type: "Scene",
      name: name || sceneId,
      system,
      flags: {},
      ownership: { default: "LIMITED" },
      _rev: 0,
    };
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

  private toDoc(token: TokenRecord): Document<TokenSystem> {
    return {
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
      _rev: token._rev,
    };
  }

  private expireLocks(): void {
    const now = Date.now();
    for (const [tokenId, lock] of this.locks) {
      if (lock.expiresAt <= now) this.locks.delete(tokenId);
    }
  }
}

export type TokenDoc = Document<{ x: number; y: number; sceneId: string }>;
