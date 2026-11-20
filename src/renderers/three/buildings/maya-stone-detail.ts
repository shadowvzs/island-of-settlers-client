import { fract, smoothstep } from "../../../shared/world/noise";
import { periodicNoise } from "./roman-texture-grain";
import { blockVariation, type RomanSurfaceDetail, seamDistance, type SurfaceCoordinate,
  type SurfaceSampler, wrapIndex } from "./surface-detail-common";

/** Broad dressed limestone, with straight staggered beds rather than warped adobe lines. */
export const MAYA_STONE_COURSES = 4;
export const MAYA_STONE_BLOCKS = 2;
const COURSES = MAYA_STONE_COURSES, BLOCKS = MAYA_STONE_BLOCKS;
type Stroke = readonly [number, number, number, number];
const FRET: readonly Stroke[] = [[-.33, -.27, -.33, .27], [-.33, .27, .29, .27],
  [.29, .27, .29, -.03], [.29, -.03, -.02, -.03], [-.02, -.03, -.02, -.25], [-.02, -.25, .34, -.25]];
const WATER: readonly Stroke[] = [[-.34, -.2, -.12, -.2], [-.12, -.2, -.12, -.04],
  [-.12, -.04, .12, -.04], [.12, -.04, .12, .12], [.12, .12, .34, .12],
  [-.34, .04, -.12, .04], [-.12, .04, -.12, .2], [-.12, .2, .1, .2]];
const MAIZE: readonly Stroke[] = [[0, -.3, 0, .3], [-.29, -.16, 0, .03], [.29, -.16, 0, .03],
  [-.25, .04, 0, .18], [.25, .04, 0, .18], [-.08, .18, .08, .18], [-.08, .29, .08, .29]];
const MOTIFS = [FRET, WATER, MAIZE] as const;

/** Stroke distance in world-sized tile coordinates, so horizontal and vertical incisions have equal width. */
const strokeDistance = (x: number, y: number, [ax, ay, bx, by]: Stroke) => {
  const dx = (bx - ax) / BLOCKS, dy = (by - ay) / COURSES;
  const px = (x - ax) / BLOCKS, py = (y - ay) / COURSES;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - dx * t, py - dy * t);
};

const limestone = ({ grain, mineral, u, v, weather }: SurfaceCoordinate,
  carved: boolean): RomanSurfaceDetail => {
  const bed = v * COURSES;
  const row = wrapIndex(Math.floor(bed), COURSES);
  const shift = row % 2 * .5;
  const column = u * BLOCKS + shift;
  const block = wrapIndex(Math.floor(column), BLOCKS);
  const variation = blockVariation(block + row * 9, row + 13);
  const joint = Math.min(seamDistance(bed) / COURSES, seamDistance(column) / BLOCKS);
  const chipped = periodicNoise(u, v, 16) * .0015;
  const face = smoothstep(.0025 + chipped * .25, .0065 + chipped * .5, joint);
  let incision = 0;
  // Selected individual block faces carry original stepped/water/maize carvings, with bare blocks between.
  if (carved && variation > .77) {
    const strokes = MOTIFS[(block * 2 + row) % MOTIFS.length]!;
    let distance = 1;
    for (const stroke of strokes)
      distance = Math.min(distance, strokeDistance(fract(column) - .5, fract(bed) - .5, stroke));
    incision = (1 - smoothstep(.0035, .011, distance)) * face;
  }
  const tone = variation - .5, pitting = grain < .025 ? .025 : 0;
  const stoneHeight = .16 + (mineral - .5) * .025 + (grain - .5) * .008 - pitting * .2;
  return {
    brightness: .87 + face * .12 + tone * .045 + (weather - .5) * .012 - incision * .09 - pitting * .25,
    colour: [1.025 + tone * .025, 1.008, .96 - tone * .018],
    // Incisions cut below the stone face: these grooves never form raised painted badges.
    height: .46 + face * stoneHeight - incision * .10,
    roughness: 228 + (1 - face) * 20 + incision * 7 + grain * 8
  };
};

/** Straight staggered warm limestone, used on foundation/coping stone. */
export const mayaLimestoneDetail: SurfaceSampler = point => limestone(point, false);
/** Same stone with recessed carved motifs, shared by High normals and Minimal cavity shading. */
export const mayaCarvedLimestoneDetail: SurfaceSampler = point => limestone(point, true);
