import { describe, expect, it } from "vitest";

import {
  CERVID_LEGS,
  computeAnimalPose,
  createRestMotion
} from "../src/render-common/wildlife/model/animal-pose";
import { POSE, POSE_CHANNELS } from "../src/render-common/wildlife/model/animal-rig";
import { SPECIES, SPECIES_PROFILES } from "../src/render-common/wildlife/wildlife-species";

// Track the horizontal position of a planted front hoof while its body advances.
// This detects the old constant angular sweep, which slid the hoof even at steady speed.
describe("natural cervid stance", () => {
  it.each([SPECIES.deer, SPECIES.elk])(
    "keeps species %i front hooves planted through walk and trot",
    (species) => {
      for (const [name, duty, offset] of [
        ["walk", 0.64, 0.25],
        ["trot", 0.48, 0.5]
      ] as const) {
        const motion = createRestMotion();
        motion.move = 1;
        motion.trot = name === "trot" ? 1 : 0;
        const profile = SPECIES_PROFILES[species]!;
        const pose = new Float32Array(POSE_CHANNELS);
        let first = NaN,
          maxSlide = 0;
        for (let sample = 0; sample <= 20; sample++) {
          const stance = duty * (0.05 + (0.9 * sample) / 20);
          motion.gaitPhase = stance - offset;
          computeAnimalPose(species, motion, pose, 0);
          const bodyTravel = stance * profile[name].stride;
          const hoof =
            bodyTravel + CERVID_LEGS[species]!.front * Math.sin(pose[POSE.frontLeftHip]!);
          if (!sample) first = hoof;
          maxSlide = Math.max(maxSlide, Math.abs(hoof - first));
        }
        expect(maxSlide).toBeLessThan(0.000001);
      }
    }
  );
});
