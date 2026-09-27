import type { Document } from "./documents.js";

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
}

export interface DocumentTypeContribution {
  id: string;
  base: "Actor" | "Item" | "Scene";
  schemaVersion: number;
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