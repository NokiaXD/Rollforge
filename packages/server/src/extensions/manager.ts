import type {
  ExtensionManifest,
  ChatCommandContribution,
} from "@rollforge/protocol";
import {
  type ServerExtensionAPI,
  type HooksEngine,
  type CommandHandler,
  freezeServerAPI,
  CommandRejection,
} from "@rollforge/extension-api";
import { validateManifest, CORE_VERSION } from "./manifest";
import { ChatCommandRegistry, type RegisteredCommand } from "./registry";
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

export interface ExtensionManagerOptions {
  coreVersion?: string | undefined;
  activationTimeoutMs?: number | undefined;
  hooks: HooksEngine;
  commandRegistry: ChatCommandRegistry;
  getUsersAPI?: (() => ServerExtensionAPI["users"]) | undefined;
  getDocumentsAPI?: (() => ServerExtensionAPI["documents"]) | undefined;
  getDocumentStore?: (() => any) | undefined;
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
  private getUsersAPI?: (() => ServerExtensionAPI["users"]) | undefined;
  private getDocumentsAPI?: (() => ServerExtensionAPI["documents"]) | undefined;
  private getDocumentStore?: (() => any) | undefined;
  private getChatSendHandler?: (() => ServerExtensionAPI["chat"]["send"]) | undefined;

  constructor(options: ExtensionManagerOptions) {
    this.coreVersion = options.coreVersion ?? CORE_VERSION;
    this.timeoutMs = options.activationTimeoutMs ?? 5000;
    this.hooks = options.hooks;
    this.commandRegistry = options.commandRegistry;
    this.getUsersAPI = options.getUsersAPI;
    this.getDocumentsAPI = options.getDocumentsAPI;
    this.getDocumentStore = options.getDocumentStore;
    this.getChatSendHandler = options.getChatSendHandler;
  }

  registerExtension(entry: ExtensionEntry): void {
    const val = validateManifest(entry.manifest, this.coreVersion);
    if (!val.ok || !val.manifest || !val.effectiveEvents) {
      const err = new Error(val.error ?? "Invalid extension manifest");
      const record: ExtensionRecord = {
        id: entry.manifest?.id ?? "unknown",
        state: "Incompatible",
        entry,
        effectiveEvents: [],
        error: err,
      };
      this.extensions.set(record.id, record);
      throw err;
    }

    const id = val.manifest.id;
    if (this.extensions.has(id)) {
      throw new Error(`Extension "${id}" is already registered`);
    }

    // Process contributes without running code
    if (val.manifest.contributes?.chatCommands) {
      for (const cmd of val.manifest.contributes.chatCommands) {
        const cmdName = cmd.name.toLowerCase();
        const existing = this.contributedCommands.get(cmdName);
        if (existing) {
          throw new Error(
            `Chat command "${cmdName}" contributed by "${id}" conflicts with extension "${existing.extensionId}"`
          );
        }
        this.contributedCommands.set(cmdName, {
          name: cmdName,
          description: cmd.description,
          requiredPermission: cmd.requiredPermission ?? "Player",
          extensionId: id,
        });
      }
    }

    const record: ExtensionRecord = {
      id,
      state: "Registered",
      entry,
      effectiveEvents: val.effectiveEvents,
    };
    this.extensions.set(id, record);
  }

  getExtension(id: string): ExtensionRecord | undefined {
    return this.extensions.get(id);
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
      get: async (id) => (this.getDocumentsAPI ? this.getDocumentsAPI().get(id) : null),
      create: async (input) => {
        if (!this.getDocumentsAPI) throw new Error("Document API not available");
        return this.getDocumentsAPI().create(input);
      },
      update: async (id, patch) => {
        if (!this.getDocumentsAPI) throw new Error("Document API not available");
        return this.getDocumentsAPI().update(id, patch);
      },
      delete: async (id) => {
        if (!this.getDocumentsAPI) throw new Error("Document API not available");
        return this.getDocumentsAPI().delete(id);
      },
    };

    const api: ServerExtensionAPI = {
      documents,
      hooks,
      chat,
      dice,
      users,
      context: { extensionId },
      errors: { CommandRejection },
    };

    return freezeServerAPI(api);
  }
}
