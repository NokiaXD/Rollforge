import type { Document } from "./documents";

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  engines: { core: string };
  activationEvents: string[];
  contributes?: {
    documentTypes?: DocumentTypeContribution[];
    sheets?: SheetContribution[];
    chatCommands?: ChatCommandContribution[];
  };
  main?: { server?: string; client?: string };
  builtin?: boolean;
}

// "campaign" (default) is ordinary campaign state: migrated eagerly when the
// extension activates, writable by its owners. "compendium" is a read-only
// wrapper type — one document per entry of an importable pack. Those are
// migrated lazily on open (§12: thousands of entries must not block boot)
// and the HTTP layer refuses to write them; the owning extension still
// populates them in-process via api.documents.
export type DocumentTypeScope = "campaign" | "compendium";

export interface DocumentTypeContribution {
  id: string;
  base: "Actor" | "Item" | "Scene";
  schemaVersion: number;
  scope?: DocumentTypeScope;
}

export interface SheetContribution {
  documentType: string;
  component: string;
  default?: boolean;
}

export interface ChatCommandContribution {
  name: string;
  description: string;
  requiredPermission?: "GM" | "Player";
}

export type { Document };