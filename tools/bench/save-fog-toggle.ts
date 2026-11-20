import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { packFog, unpackFog } from "../../src/shared/settlement/save-cell-codecs";

/** Changes the first fog cell of a save (a small, valid edit for repeat-write measurements). */
export const toggleFirstFogCell = (save: GameSaveV1) => {
  const fog = unpackFog(save.progress.fog, save.progress.fog.length);
  if (!fog.length) return;
  fog[0] = fog[0] === 2 ? 1 : 2;
  save.progress.fog = packFog(fog);
};
