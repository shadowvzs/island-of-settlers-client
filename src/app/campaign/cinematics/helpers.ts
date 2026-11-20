import type { MapRegion } from "../../../../../island-of-settlers-shared/src/campaign/campaign-regions";
import type { CameraShot } from "../../../../../island-of-settlers-shared/src/campaign/cinematics/types";
import type { CameraOrbit, CinematicPoint } from "../../../render-common/cinematic/cinematic-frame";
import { DEFAULT_SHOT_FOV, LETTERBOX_ASPECT, LETTERBOX_PORTRAIT_SHARE } from "./constants";

type GroundHeight = (x: number, z: number) => number;

/**
 * Height (CSS px) of each letterbox bar at full slide-in: landscape crops to a 2.0:1 picture, portrait
 * (taller than wide) keeps at most 6 % of the height per bar so the scene stays readable on phones.
 */
export const letterboxBarHeight = (width: number, height: number) => {
  if (width <= 0 || height <= 0) return 0;
  if (height > width) return height * LETTERBOX_PORTRAIT_SHARE;
  return Math.max(0, (height - width / LETTERBOX_ASPECT) / 2);
};

/** A stored shot as an orbit: the target follows the camera ground unless the shot fixes `targetY`. */
export const shotToOrbit = (shot: CameraShot, groundHeight: GroundHeight): CameraOrbit => ({
  distance: shot.distance,
  fov: shot.fov ?? DEFAULT_SHOT_FOV,
  pitch: shot.pitch,
  targetX: shot.targetX,
  targetY: shot.targetY ?? groundHeight(shot.targetX, shot.targetZ),
  targetZ: shot.targetZ,
  yaw: shot.yaw
});

/** The centre of a region (circle centre, rectangle middle, the point itself) on the camera ground. */
export const regionCenter = (region: MapRegion, groundHeight: GroundHeight): CinematicPoint => {
  const { shape } = region;
  let x = 0, z = 0;
  if (shape.kind === "circle") ({ centerX: x, centerZ: z } = shape);
  else if (shape.kind === "point") ({ x, z } = shape);
  else {
    x = (shape.minX + shape.maxX) / 2;
    z = (shape.minZ + shape.maxZ) / 2;
  }
  return { x, y: groundHeight(x, z), z };
};
