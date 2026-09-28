import type { CommandHandler } from "@rollforge/extension-api";

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
        `Chat command "${normalized}" is already registered by extension "${existing.extensionId}"`
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
