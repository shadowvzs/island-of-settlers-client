import type { Vec3 } from "../../props/mesh-builder";
import { SPECIES } from "../wildlife-species";
import type { StageShape } from "../wildlife-stages";
import { SPECIES_ANATOMY } from "./species-anatomy";

/**
 * Head pitch while grazing (radians, + lifts the muzzle forward), shared with the pose. With the
 * neck bent down at the chest, the head turns slightly forward so the face points straight
 * down with the muzzle in front of the forelegs (the source's nose-down pitch curled the head
 * back under the chest and kept the muzzle off the grass).
 */
export const GRAZE_HEAD_PITCH = 0.3;
/** Height the nose reaches when the head is fully down (just above the grass roots). */
const GRAZE_NOSE_HEIGHT = 0.03;

/** The points the grazing reach depends on. */
export interface GrazeHead {
  head: Vec3;
  neck: Vec3;
  nose: Vec3;
}

const rotateAbout = (point: Vec3, pivot: Vec3, angle: number): Vec3 => {
  const x = point[0] - pivot[0];
  const y = point[1] - pivot[1];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos - y * sin + pivot[0], x * sin + y * cos + pivot[1], point[2]];
};

/**
 * Neck pitch that lowers the nose to the grass: the neck bends at its base (not just the head
 * at the top), searched once per species from its proportions.
 */
const solveGrazeNeck = (head: GrazeHead) => {
  const nose = rotateAbout(head.nose, head.head, GRAZE_HEAD_PITCH);
  let best = 0;
  let bestError = Infinity;
  for (let angle = 0; angle >= -1.8; angle -= 0.01) {
    const error = Math.abs(rotateAbout(nose, head.neck, angle)[1] - GRAZE_NOSE_HEIGHT);
    if (error < bestError) {
      bestError = error;
      best = angle;
    }
  }
  return best;
};

/**
 * Neck base, head pivot and nose tip of the adult source models in rest pose (island units,
 * measured from the GLBs; tests/wildlife-models.test.ts keeps them in sync with the assets).
 */
export const GRAZE_HEADS: Record<number, GrazeHead> = {
  [SPECIES.deer]: { head: [0.349, 0.633, 0], neck: [0.165, 0.42, 0], nose: [0.515, 0.617, 0] },
  [SPECIES.elk]: { head: [0.499, 0.852, 0], neck: [0.212, 0.594, 0], nose: [0.728, 0.882, 0] }
};

/**
 * The graze points after an anatomy morph (model-morph): the neck base moves with the trunk
 * about the body pivot (origin, `rootHeight` up), the head along the neck by its length.
 */
const reshapeHead = (head: GrazeHead, shape: StageShape, rootHeight: number): GrazeHead => {
  const neck: Vec3 = [
    head.neck[0] * shape.body[0],
    rootHeight + (head.neck[1] - rootHeight) * shape.body[1],
    0
  ];
  const pivot: Vec3 = [
    neck[0] + (head.head[0] - head.neck[0]) * shape.neckLength,
    neck[1] + (head.head[1] - head.neck[1]) * shape.neckLength,
    0
  ];
  const nose: Vec3 = [
    pivot[0] + (head.nose[0] - head.head[0]) * shape.head[0],
    pivot[1] + (head.nose[1] - head.head[1]) * shape.head[1],
    0
  ];
  return { head: pivot, neck, nose };
};

/** Body pivot height of the sources (between their leg tops). */
const ROOT_HEIGHTS: Record<number, number> = { [SPECIES.deer]: 0.428, [SPECIES.elk]: 0.576 };

const solveSpeciesNeck = (species: number) =>
  solveGrazeNeck(
    reshapeHead(GRAZE_HEADS[species]!, SPECIES_ANATOMY[species]!, ROOT_HEIGHTS[species]!)
  );

const GRAZE_NECK: Record<number, number> = {
  [SPECIES.deer]: solveSpeciesNeck(SPECIES.deer),
  [SPECIES.elk]: solveSpeciesNeck(SPECIES.elk)
};

export const getCervidGrazeNeck = (species: number) => GRAZE_NECK[species] ?? 0;
