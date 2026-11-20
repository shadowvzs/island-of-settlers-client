import type { IUniform, Vector4 } from "three";

import {
  createSeasonGroundUniforms,
  writeSeasonGroundUniforms
} from "../../render-common/seasonal-appearance/season-ground";
import type { SeasonWeights } from "../../render-common/seasonal-appearance/season-weights";

const setVector = (uniform: IUniform | undefined, values: readonly number[]) => {
  (uniform?.value as Vector4 | undefined)?.fromArray(values);
};

/**
 * Per-frame writer of the shared season uniforms: uSeason (foliage: autumn, dormant, spring, monsoon) and the
 * ground's uSeasonMeadow / uSeasonLitter / uSeasonCover (season-ground.ts). No allocation per frame.
 */
export const createSeasonUniformWriter = (uniforms: Record<string, IUniform>) => {
  const ground = createSeasonGroundUniforms();
  const foliage = [0, 0, 0, 0];
  return (season: SeasonWeights | undefined) => {
    foliage[0] = season?.autumn ?? 0;
    foliage[1] = season?.dormant ?? 0;
    foliage[2] = season?.spring ?? 0;
    foliage[3] = season?.monsoon ?? 0;
    setVector(uniforms.uSeason, foliage);
    writeSeasonGroundUniforms(season, ground);
    setVector(uniforms.uSeasonMeadow, ground.meadow);
    setVector(uniforms.uSeasonLitter, ground.litter);
    setVector(uniforms.uSeasonCover, ground.cover);
  };
};
