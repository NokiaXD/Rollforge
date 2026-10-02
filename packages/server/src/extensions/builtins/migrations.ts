import type { ExtensionManifest } from "@rollforge/protocol";
import { CommandRejection, type ServerExtensionAPI } from "@rollforge/extension-api";

//  /migrations is a builtin admin command. It uses the narrow
// api.migrations surface (listBlocked, retry, review) exposed by the host
// instead of touching db/MigrationRegistry directly — the builtins lint
// boundary forbids `../*` imports, which is what forces this discipline.
// Lives here so it goes through the same lifecycle (register, activate,
// deactivate, retryExtension) as every other extension-contributed command.

export const manifest: ExtensionManifest = {
  id: "core-migrations",
  name: "Core Migrations Admin",
  version: "0.1.0",
  engines: { core: ">=0.1.0" },
  builtin: true,
  activationEvents: ["onCommand:migrations"],
  contributes: {
    chatCommands: [
      {
        name: "migrations",
        description: "List blocked documents, retry one, or apply a GM patch",
        requiredPermission: "GM",
      },
    ],
  },
};

function parseReviewArgs(args: string[]): {
  docId: string;
  skipSteps: number[];
  systemOverride: unknown;
} {
  if (args.length !== 4) throw new CommandRejection("not-a-command");
  const [, docId, skipList, systemJson] = args;
  const skipSteps = skipList!
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 0);
  let systemOverride: unknown;
  try {
    systemOverride = JSON.parse(systemJson!);
  } catch {
    throw new CommandRejection("not-a-command");
  }
  return { docId: docId!, skipSteps, systemOverride };
}

export function activate(api: ServerExtensionAPI): void {
  api.chat.registerCommand({
    name: "migrations",
    description: "List blocked documents, retry one, or apply a GM patch",
    requiredPermission: "GM",
    handler: async ({ args }) => {
      const sub = (args[0] ?? "").toLowerCase();

      if (sub === "list" || sub === "") {
        const rows = await api.migrations.listBlocked();
        if (rows.length === 0) {
          await api.chat.send("No blocked documents.");
          return;
        }
        const summary = rows
          .map(
            (r) =>
              `- ${r.docId} (${r.docType}) at v${r.prevVersion}, blocked at ${new Date(r.createdAt).toISOString()}`,
          )
          .join("\n");
        await api.chat.send(`Blocked documents:\n${summary}`);
        return;
      }

      if (sub === "retry") {
        if (args.length !== 2) throw new CommandRejection("not-a-command");
        const docId = args[1]!;
        const existing = await api.documents.get(docId);
        if (!existing) {
          await api.chat.send(`Document ${docId} not found.`);
          return;
        }
        const result = await api.migrations.retry(docId);
        if (result.ok) {
          await api.chat.send(`Document ${docId} migrated to v${result.toVersion}.`);
        } else {
          await api.chat.send(
            `Document ${docId} still blocked at v${result.atFrom}→v${result.atTo}: ${result.error}`,
          );
        }
        return;
      }

      if (sub === "review") {
        const { docId, skipSteps, systemOverride } = parseReviewArgs(args);
        const existing = await api.documents.get(docId);
        if (!existing) {
          await api.chat.send(`Document ${docId} not found.`);
          return;
        }
        const result = await api.migrations.review(docId, {
          skipSteps,
          systemOverride,
        });
        if (result.ok) {
          await api.chat.send(
            `Document ${docId} patched and migrated to v${result.toVersion}.`,
          );
        } else {
          await api.chat.send(
            `Document ${docId} still blocked at v${result.atFrom}→v${result.atTo}: ${result.error}`,
          );
        }
        return;
      }

      throw new CommandRejection("not-a-command");
    },
  });
}

export function deactivate(): void {
  // Cleaned up defensibly by ExtensionManager
}