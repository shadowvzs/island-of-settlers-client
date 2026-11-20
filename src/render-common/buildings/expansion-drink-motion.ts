import type { BuildingFirstNation } from "../workers/worker-nation";
import type { Point3 } from "./building-recipe";
import { expansionDrinkWorkstation } from "./expansion-drink-maker-layout";

export interface DrinkWorkFrame {
  elapsed: number;
  nation: BuildingFirstNation;
  origin: Point3;
  rotation: number;
  scale: number;
}

export const DRINK_MOTION_SECONDS = 4;

/** Tool and hands share a loop within the unchanged sixteen-second production cycle. */
export const sampleExpansionDrinkMotion = (nation: BuildingFirstNation, elapsed: number) => {
  const phase = elapsed * Math.PI * 2 / DRINK_MOTION_SECONDS;
  const wave = Math.sin(phase), cosine = Math.cos(phase);
  if (nation === "chinese") return { offset: [0, .004 * cosine, .038 * wave] as Point3,
    rotation: [.8 * wave, 0, 0] as Point3 };
  if (nation === "persian") return { offset: [0, 0, 0] as Point3,
    rotation: [0, .65 * wave, 0] as Point3 };
  if (nation === "maya") return { offset: [0, .006 * cosine, .045 * wave] as Point3,
    rotation: [.32 * wave, 0, 0] as Point3 };
  return { offset: [0, .065 * (1 - cosine), 0] as Point3, rotation: [0, 0, 0] as Point3 };
};

export const expansionDrinkHandTarget = (frame: DrinkWorkFrame, right: boolean): Point3 => {
  const layout = expansionDrinkWorkstation(frame.nation);
  const point = [...(right ? layout.rightGrip : layout.leftGrip)] as Point3;
  const { offset, rotation } = sampleExpansionDrinkMotion(frame.nation, frame.elapsed);
  if (frame.nation === "persian") {
    const x = point[0] - layout.machineBase[0];
    point[0] = layout.machineBase[0] + Math.cos(rotation[1]) * x;
    point[2] -= Math.sin(rotation[1]) * x;
  } else if (frame.nation !== "indigenous" || !right) {
    for (const axis of [0, 1, 2] as const) point[axis] += offset[axis];
  }
  const x = point[0] * frame.scale, z = point[2] * frame.scale;
  return [frame.origin[0] + x * Math.cos(frame.rotation) + z * Math.sin(frame.rotation),
    frame.origin[1] + point[1] * frame.scale,
    frame.origin[2] - x * Math.sin(frame.rotation) + z * Math.cos(frame.rotation)];
};
