import type {
  ScriptActionRequest, ScriptActionResult
} from "../../../../../island-of-settlers-shared/src/script/engine/ports";
import { factionArg, type ScriptActionHost, stringArg } from "./action-host";

/**
 * `setCommanderLevel` (A14 plan §7 step 1, lane A14-5): the level a computer faction's military commander plays
 * at from its next decision on. It outranks the map's AI level, the island's and the global difficulty, and is
 * saved with the island's combat state. Refused for the player, a player group or an unknown level.
 */

const DONE: ScriptActionResult = { kind: "done" };
const REFUSED: ScriptActionResult = { kind: "failed", outcome: "refused" };

const setCommanderLevel = (host: ScriptActionHost, { args, scope }: ScriptActionRequest): ScriptActionResult => {
  const faction = factionArg(args.faction);
  if (faction === null) return REFUSED;
  return host.context.commanderLevels?.set(faction, stringArg(scope, args.level, "")) ? DONE : REFUSED;
};

export const COMMANDER_ACTIONS: Readonly<Record<string, (host: ScriptActionHost, request: ScriptActionRequest) =>
  ScriptActionResult>> = { setCommanderLevel };
