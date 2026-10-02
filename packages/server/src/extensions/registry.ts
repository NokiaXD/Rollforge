import type { CommandHandler } from "@rollforge/extension-api";
import {
  type DocumentTypeContribution,
  type MigrationChain,
  type SheetContribution,
  SheetOwnerConflict,
  validateMigrationChain,
} from "@rollforge/protocol";

export interface RegisteredCommand {
  name: string;
  description: string;
  handler: CommandHandler;
  requiredPermission: "GM" | "Player";
  extensionId: string;
}

export class ChatCommandRegistry {
  private commands = new Map<string, RegisteredCommand>();

  register(cmd: RegisteredCommand): void {
    const normalized = cmd.name.toLowerCase();
    const existing = this.commands.get(normalized);
    if (existing) {
      throw new Error(
        `Chat command "${normalized}" is already registered by extension "${existing.extensionId}"`,
      );
    }
    this.commands.set(normalized, {
      ...cmd,
      name: normalized,
      requiredPermission: cmd.requiredPermission ?? "Player",
    });
  }

  get(name: string): RegisteredCommand | undefined {
    return this.commands.get(name.toLowerCase());
  }

  has(name: string): boolean {
    return this.commands.has(name.toLowerCase());
  }

  unregisterAll(extensionId: string): void {
    for (const [name, cmd] of this.commands.entries()) {
      if (cmd.extensionId === extensionId) {
        this.commands.delete(name);
      }
    }
  }

  list(): RegisteredCommand[] {
    return Array.from(this.commands.values());
  }
}

export interface RegisteredDocumentType {
  type: DocumentTypeContribution;
  extensionId: string;
}

export class DocumentTypeRegistry {
  private byId = new Map<string, RegisteredDocumentType>();

  register(type: DocumentTypeContribution, extensionId: string): void {
    const existing = this.byId.get(type.id);
    if (existing) {
      throw new Error(
        `documentType "${type.id}" is already contributed by extension "${existing.extensionId}"`,
      );
    }
    this.byId.set(type.id, { type, extensionId });
  }

  get(id: string): RegisteredDocumentType | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  unregisterAll(extensionId: string): void {
    for (const [id, entry] of this.byId.entries()) {
      if (entry.extensionId === extensionId) {
        this.byId.delete(id);
      }
    }
  }

  list(): RegisteredDocumentType[] {
    return Array.from(this.byId.values());
  }
}

export interface RegisteredSheet {
  sheet: SheetContribution;
  extensionId: string;
  // The prior default entry this slot overrode, if any. Used by unregisterAll
  // to restore the previous owner when the overriding extension deactivates.
  previousDefault?: RegisteredSheet;
}

export interface SheetRegistryOpts {
  //  the documentType → owner lookup is the source of truth (§12 needs
  // it for schemaVersion tracking). SheetRegistry asks instead of duplicating.
  getDocumentTypeOwner?: (documentType: string) => string | undefined;
}

export class SheetRegistry {
  private byDocType = new Map<string, RegisteredSheet[]>();

  constructor(private readonly opts: SheetRegistryOpts = {}) {}

  register(sheet: SheetContribution, extensionId: string): void {
    const list = this.byDocType.get(sheet.documentType) ?? [];
    if (sheet.default === true) {
      const existingIdx = list.findIndex((r) => r.sheet.default === true);
      if (existingIdx >= 0) {
        const existing = list[existingIdx]!;
        // The owner of the documentType (contributed via contributes.documentTypes)
        // is the only one that may override silently. For BASE types — Actor, Item,
        // Scene — there is no contributor; the first registration wins ownership.
        const ownerId =
          this.opts.getDocumentTypeOwner?.(sheet.documentType) ?? existing.extensionId;
        if (extensionId !== ownerId) {
          throw new SheetOwnerConflict(sheet.documentType, ownerId, extensionId);
        }
        // Owner override: replace in place, preserve previous default for restoration.
        list[existingIdx] = { sheet, extensionId, previousDefault: existing };
        this.byDocType.set(sheet.documentType, list);
        return;
      }
    }
    list.push({ sheet, extensionId });
    this.byDocType.set(sheet.documentType, list);
  }

  forDocumentType(documentType: string): RegisteredSheet[] {
    return this.byDocType.get(documentType) ?? [];
  }

  defaultFor(documentType: string): RegisteredSheet | undefined {
    return this.forDocumentType(documentType).find((e) => e.sheet.default === true);
  }

  unregisterAll(extensionId: string): void {
    for (const [docType, list] of this.byDocType.entries()) {
      let mutated = false;
      const next: RegisteredSheet[] = [];
      for (const entry of list) {
        if (entry.extensionId !== extensionId) {
          next.push(entry);
          continue;
        }
        mutated = true;
        if (entry.previousDefault) {
          // Restore the prior default. Its previousDefault is intentionally
          // dropped — one level of history is enough.  rebuild the
          // object literal without the previousDefault key so exactOptional-
          // PropertyTypes stays happy.
          const { previousDefault: _omit, ...rest } = entry.previousDefault;
          next.push(rest);
        }
      }
      if (!mutated) continue;
      if (next.length === 0) {
        this.byDocType.delete(docType);
      } else {
        this.byDocType.set(docType, next);
      }
    }
  }

  list(): RegisteredSheet[] {
    return Array.from(this.byDocType.values()).flat();
  }
}

export interface RegisteredMigrationChain {
  type: string;
  chain: MigrationChain;
  targetVersion: number;
  extensionId: string;
}

//  registry mirrors DocumentTypeRegistry — register once per type,
// unregisterAll on extension teardown, throw via result (not exception) on
// chain-shape errors so manager.registerExtension() can record Incompatible
// without crashing the load loop.
export class MigrationRegistry {
  private byType = new Map<string, RegisteredMigrationChain>();

  register(
    type: string,
    chain: MigrationChain,
    targetVersion: number,
    extensionId: string,
  ): { ok: true } | { ok: false; reason: string } {
    const existing = this.byType.get(type);
    if (existing) {
      return {
        ok: false,
        reason: `migration chain for "${type}" already registered by extension "${existing.extensionId}"`,
      };
    }
    const issue = validateMigrationChain(chain, targetVersion);
    if (issue) {
      return { ok: false, reason: `migration chain for "${type}" is invalid: ${issue}` };
    }
    this.byType.set(type, { type, chain, targetVersion, extensionId });
    return { ok: true };
  }

  get(type: string): RegisteredMigrationChain | undefined {
    return this.byType.get(type);
  }

  has(type: string): boolean {
    return this.byType.has(type);
  }

  unregisterAll(extensionId: string): void {
    for (const [type, entry] of this.byType.entries()) {
      if (entry.extensionId === extensionId) {
        this.byType.delete(type);
      }
    }
  }

  list(): RegisteredMigrationChain[] {
    return Array.from(this.byType.values());
  }
}