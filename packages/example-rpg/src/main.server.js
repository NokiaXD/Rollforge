import { migrations } from "./migrations.js";

export function activate(api) {
  api.documents.registerMigrations("example-character", migrations);

  api.chat.registerCommand({
    name: "ex-roll",
    description: "Lanza dados del sistema Example RPG",
    requiredPermission: "Player",
    handler: async ({ rest }, ctx) => {
      const notation = rest.trim() || "1d20";
      const result = await api.dice.roll(notation, { userId: ctx.userId });
      await api.chat.send(`Example RPG roll (${notation}): ${result.total}`, {
        kind: "roll",
        result,
      });
    },
  });

  api.chat.registerCommand({
    name: "ex-init",
    description: "Tira iniciativa para el grupo",
    requiredPermission: "Player",
    handler: async (_args, ctx) => {
      const result = await api.dice.roll("1d20", { userId: ctx.userId });
      await api.chat.send(`Iniciativa de grupo: ${result.total}`, {
        kind: "roll",
        result,
      });
    },
  });
}

export function deactivate() {}
