import type { ExtensionManifest } from "@rollforge/protocol";
import { CommandRejection, type ServerExtensionAPI } from "@rollforge/extension-api";

export const manifest: ExtensionManifest = {
  id: "core-chat-dice",
  name: "Core Chat and Dice",
  version: "0.1.0",
  engines: { core: ">=0.1.0" },
  builtin: true,
  activationEvents: ["onCommand:roll", "onCommand:w", "onCommand:whisper"],
  contributes: {
    chatCommands: [
      {
        name: "roll",
        description: "Roll dice using standard notation",
        requiredPermission: "Player",
      },
      {
        name: "w",
        description: "Whisper message to another user",
        requiredPermission: "Player",
      },
      {
        name: "whisper",
        description: "Whisper message to another user",
        requiredPermission: "Player",
      },
    ],
  },
};

export function activate(api: ServerExtensionAPI): void {
  const rollHandler = async (
    { args }: { args: string[]; rest: string },
    ctx: { userId: string; isGM: boolean }
  ) => {
    if (args.length !== 1) {
      throw new CommandRejection("not-a-command");
    }
    const notation = args[0]!;
    const result = await api.dice.roll(notation, { userId: ctx.userId });
    await api.chat.send(notation, {
      kind: "roll",
      rolls: result.terms.map((t) => t.roll),
      result,
    });
  };

  const whisperHandler = async (
    { args, rest }: { args: string[]; rest: string },
    _ctx: { userId: string; isGM: boolean }
  ) => {
    if (args.length < 2) {
      throw new CommandRejection("not-a-command");
    }
    const recipientName = args[0]!;
    const recipient = api.users.findByName(recipientName);
    if (!recipient) {
      throw new CommandRejection("not-found");
    }

    const idx = rest.indexOf(recipientName);
    const body = rest.slice(idx + recipientName.length).trimStart();
    await api.chat.send(body, {
      to: recipient.id,
      kind: "whisper",
    });
  };

  api.chat.registerCommand({
    name: "roll",
    description: "Roll dice using standard notation",
    requiredPermission: "Player",
    handler: rollHandler,
  });

  api.chat.registerCommand({
    name: "w",
    description: "Whisper message to another user",
    requiredPermission: "Player",
    handler: whisperHandler,
  });

  api.chat.registerCommand({
    name: "whisper",
    description: "Whisper message to another user",
    requiredPermission: "Player",
    handler: whisperHandler,
  });
}

export function deactivate(): void {
  // Cleaned up defensibly by ExtensionManager
}
