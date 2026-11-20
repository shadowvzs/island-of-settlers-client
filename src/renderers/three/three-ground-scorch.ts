import type { IUniform } from "three";

import { RUIN_SCORCH, type RuinScorchState } from "../../render-common/ruin-scorch";

type ScorchUniforms = { uScorch: IUniform<Float32Array>; uScorchCount: IUniform<number> };

/** The ruin scorch discs of the ground (GROUND-PALETTE step 7): none until a ruin falls. */
export const createRuinScorchUniforms = (): ScorchUniforms => ({
  uScorch: { value: new Float32Array(RUIN_SCORCH.maxDiscs * 4) },
  uScorchCount: { value: 0 }
});

/**
 * Per frame: copies the discs only when the settlement's scorch state changed (no allocation). The uniforms are the
 * renderer's shared ones (ground, grass cover and grass ring read them).
 */
export const createRuinScorchSync = (shared: Record<string, IUniform>) => {
  const uniforms = shared as unknown as ScorchUniforms;
  let revision = -1;
  return (state: RuinScorchState | undefined) => {
    if (!state) {
      uniforms.uScorchCount.value = 0;
      return;
    }
    if (state.revision === revision) return;
    revision = state.revision;
    uniforms.uScorch.value.set(state.discs);
    uniforms.uScorchCount.value = state.count;
  };
};
