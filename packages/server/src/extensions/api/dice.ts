import {
  validateDice,
  type DiceResult,
  type RollActorRef,
  type RollActor,
  type PreDiceRollPayload,
  type PostDiceRollPayload,
} from "@rollforge/protocol";
import type { HooksEngine } from "@rollforge/extension-api";
import { CommandRejection } from "@rollforge/extension-api";
import { rollDice } from "../../dice/adapter";
import type { DocumentStore } from "../../db/documentStore";
import { canRollAsCharacter } from "../../security/authorize";
import { invocationStorage } from "../../sync/invocationContext";

export function createDiceAPI(
  hooks: HooksEngine,
  defaultUserId = "",
  getDocuments?: () => DocumentStore | null
) {
  return {
    async roll(
      notation: string,
      opts?: { actor?: RollActorRef; userId?: string }
    ): Promise<DiceResult> {
      const initial = notation?.trim() ?? "";
      const valid = validateDice(initial);
      if (!valid.ok) {
        throw new CommandRejection(valid.reason);
      }

      const current = invocationStorage.getStore();
      const userId = opts?.userId ?? current?.userId ?? defaultUserId;
      const isGM = current?.isGM ?? false;
      const requestedActor = opts?.actor ?? current?.actor;

      let resolvedActor: RollActor;
      if (requestedActor?.type === "character") {
        const documents = getDocuments ? getDocuments() : null;
        const charDoc = documents?.getById(requestedActor.characterId) ?? null;
        if (!canRollAsCharacter(userId, charDoc, isGM)) {
          throw new CommandRejection("forbidden");
        }
        const name = charDoc?.name ?? "(unknown)";
        resolvedActor = { type: "character", characterId: requestedActor.characterId, name };
      } else {
        resolvedActor = {
          type: "user",
          userId,
          name: current?.username ?? userId,
        };
      }

      const prePayload: PreDiceRollPayload = {
        notation: initial,
        userId,
        actor: requestedActor,
      };

      const filtered = await hooks.runFilter("preDiceRoll", prePayload);
      if (filtered === null) {
        throw new CommandRejection("command-failed");
      }

      const filteredValid = validateDice(filtered.notation);
      if (!filteredValid.ok) {
        throw new CommandRejection(filteredValid.reason);
      }

      let result: DiceResult;
      try {
        result = rollDice(filtered.notation);
      } catch {
        throw new CommandRejection("bad-notation");
      }

      const finalActor: RollActor =
        filtered.actor && filtered.actor.type === "character"
          ? {
              type: "character",
              characterId: filtered.actor.characterId,
              name: resolvedActor.type === "character" ? resolvedActor.name : "(unknown)",
            }
          : resolvedActor;

      const postPayload: PostDiceRollPayload = {
        notation: filtered.notation,
        userId: filtered.userId,
        result,
        actor: finalActor,
      };
      await hooks.emit("postDiceRoll", postPayload);

      return result;
    },
  };
}
