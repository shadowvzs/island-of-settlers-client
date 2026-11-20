import { FORMATS } from "../../../../island-of-settlers-shared/src/formats";
import { recoverCommander } from "../../shared/settlement/commander-recovery";
import type { GameSaveV1 } from "../../shared/settlement/game-save";

/** Only the API's stored verified home document reaches this canonical game-bundle operation. */
export const recoverSavedCommander = (input:unknown, commanderId:string) => {
  if (!input || typeof input !== "object") return null;
  const game=structuredClone(input) as GameSaveV1;
  const settlement=game.settlement;
  if (game.format !== FORMATS.gameSave.id || !settlement?.military || !settlement.world ||
      !Array.isArray(settlement.actors) || !Array.isArray(settlement.buildings) ||
      !Array.isArray(settlement.military.soldiers)) return null;
  const result=recoverCommander({ actors:settlement.actors,buildings:settlement.buildings,
    commander:settlement.military.commander,islandSeed:settlement.world.seed,soldiers:settlement.military.soldiers },commanderId);
  if (result !== true) return { ok:false as const,reason:result };
  return { ok:true as const,game };
};
