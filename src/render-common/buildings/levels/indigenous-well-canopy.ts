import { WORKER_HEIGHT } from "../../workers/worker-dimensions";
import type { LevelKit } from "./level-kit";

/** A shallow supported textile gable clears the standing operator inside the original height cap. */
export const addIndigenousWellCanopy = (kit: LevelKit) => {
  const frameTop = kit.site.recipe.mechanism[1] + .18;
  const eave = Math.max(frameTop + .02, (WORKER_HEIGHT + .035) / kit.site.scale);
  const rise = .10, peak = eave + rise, extension = peak - frameTop;
  for (const z of [-.60, .30]) {
    kit.add({ position: [0, frameTop + extension / 2 - .01, z], shape: "cylinder",
      size: [.09, extension, .09], radialSegments: kit.detailed ? 9 : 5, stage: 2, surface: "bark" });
    kit.add({ position: [0, eave - .025, z], shape: "bevel-box",
      size: [.90, .07, .065], stage: 2, surface: "wood" });
    for (const side of [-1, 1]) kit.add({ position: [side * .222, eave + rise / 2 - .008, z],
      rotation: [0, 0, -side * Math.atan2(rise, .45)], shape: "bevel-box",
      size: [Math.hypot(.45, rise), .04, .045], stage: 2, surface: "wood" });
  }
  kit.add({ occupationRoof: "gable", position: [0, eave + rise / 2, -.15], shape: "occupation-roof",
    size: [.96, rise, 1.12], stage: 3, surface: "cloth-water" });
};
