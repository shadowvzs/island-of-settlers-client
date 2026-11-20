import type { BuildingPart, Point3 } from "./building-recipe";
import { addJapaneseTransferredHip, useJapaneseTransferredHip } from "./japanese-tower-hip";
import type { RoofEnvelope, WallRun } from "./nation-kit-classify";
import {
  alongWall, envelopeCenter, envelopeSize, type KitContext,
onWall, runBetween, timberDoorFrame, wallNormal} from "./nation-kit-parts";
import { JAPANESE_ROOF_TINTS, japaneseRoofClass, japaneseRoofUnderside } from "./nation-roof-palette";
import { japaneseSoffitHeight, nationRoofMeshHeight } from "./nation-roof-profile";
import { seatStorageDoorJamb, usesStorageDoubleDoor } from "./storage-door-profile";

const POST_SPACING = .5;
/** Hip creases cross four grid cells; the last stops inside the eave to keep the plot envelope. */
const HIP_STOPS = [0, .25, .5, .75, .84];

/** Timber frame: plaster infill, dark posts at the ends and every half metre, a tie beam, base boards. */
export const japaneseWall = (context: KitContext, wall: WallRun) => {
  const { add, center, detailed } = context, normal = wallNormal(wall, center), face = normal.thickness / 2;
  add({ position: onWall(wall, center, .5, wall.base + wall.height / 2), shape: "box",
    size: alongWall(wall, wall.length, wall.height, normal.thickness), stage: 1, surface: "plaster" });
  // Minimal frames only long ground-floor walls at their ends; High adds posts and the tie beam.
  if (!detailed && (wall.length < .8 || wall.base > .1)) return;
  const posts = detailed ? Math.max(1, Math.round(wall.length / POST_SPACING)) : 1;
  for (let index = 0; index <= posts; index++) {
    let position = onWall(wall, center, index / posts, wall.base + wall.height / 2, face + .012);
    const size = alongWall(wall, .07, wall.height, .03);
    if (usesStorageDoubleDoor(context.typeId)) position = seatStorageDoorJamb(position, size, context.door);
    add({ position, shape: "box", size, stage: 2, surface: "wood" });
  }
  if (detailed) add({ position: onWall(wall, center, .5, wall.base + wall.height * .62, face + .015), shape: "box",
    size: alongWall(wall, wall.length, .055, .03), stage: 2, surface: "wood" });
  if (!detailed || context.lean || wall.base > .1) return;
  add({ position: onWall(wall, center, .5, .15, face + .01), shape: "box",
    size: alongWall(wall, wall.length, .3, .02), stage: 2, surface: "planks" });
};

/** Maps unit-roof coordinates to the building; the ridge (local z) runs along the long side. */
const roofFrame = (roof: RoofEnvelope, wallPlateHeight?: number) => {
  const size = envelopeSize(roof), base = envelopeCenter(roof), turned = size.width >= size.depth;
  const length = Math.max(size.width, size.depth), across = Math.min(size.width, size.depth);
  const height = Math.min(.6, Math.max(.3, across * .34));
  if (wallPlateHeight !== undefined)
    base[1] = wallPlateHeight + .02 - height * (.5 + japaneseSoffitHeight("japanese", 0, 0));
  const point = (x: number, z: number, detailed: boolean): Point3 => {
    const y = base[1] + height * (.5 + nationRoofMeshHeight("japanese", detailed, x, z)) - .02;
    return turned ? [base[0] + z * length, y, base[2] - x * across] : [base[0] + x * across, y, base[2] + z * length];
  };
  return { across, base, height, length, point, turned };
};

type Frame = ReturnType<typeof roofFrame>;

/** Height of the rendered roof top over a plan point, or null outside the roof. */
const roofTopAt = (roof: RoofEnvelope, x: number, z: number, detailed: boolean) => {
  const frame = roofFrame(roof), dx = x - frame.base[0], dz = z - frame.base[2];
  const [unitX, unitZ] = frame.turned
    ? [-dz / frame.across, dx / frame.length]
    : [dx / frame.across, dz / frame.length];
  if (Math.abs(unitX) > .5 || Math.abs(unitZ) > .5) return null;
  return frame.point(unitX, unitZ, detailed)[1];
};

/** Roman beams carried over under a hip roof (stage 2-3 horizontal timbers) can poke out of its slopes. */
const BEAM_MAX_HEIGHT = .2;
/** Wider timbers are wall plates and ceilings, not beams. */
const BEAM_MAX_WIDTH = .3;
const BEAM_MIN_LENGTH = .5;
const BEAM_TRIM_STEP = .02;
/** The beam's top stays this far under the tiles. */
const TILE_COVER = .01;

const pokesOut = (roofs: readonly RoofEnvelope[], x: number, top: number, z: number, detailed: boolean) =>
  roofs.some(roof => {
    const height = roofTopAt(roof, x, z, detailed);
    return height !== null && top > height - TILE_COVER && top < roof.max[1];
  });

/**
 * Shortens a long horizontal beam whose ends would pierce the swept hip ends of a Japanese roof:
 * each end steps inward until its top corners stay under the tiles.
 */
export const fitBeamUnderJapaneseRoofs = (part: BuildingPart, roofs: readonly RoofEnvelope[], detailed: boolean) => {
  if (part.shape !== "box" || part.rotation || part.stock || part.stage < 2 || part.stage > 3) return part;
  const along = part.size[0] >= part.size[2] ? 0 : 2, across = along === 0 ? 2 : 0;
  if (part.size[1] > BEAM_MAX_HEIGHT || part.size[across]! > BEAM_MAX_WIDTH || part.size[along]! < BEAM_MIN_LENGTH)
    return part;
  const top = part.position[1] + part.size[1] / 2, centre = part.position[along]!;
  const corner = (end: number, side: number) => {
    const point = [0, 0, 0];
    point[along] = end;
    point[across] = part.position[across]! + side * part.size[across]! / 2;
    return pokesOut(roofs, point[0]!, top, point[2]!, detailed);
  };
  const exposed = (end: number) => corner(end, -1) || corner(end, 1);
  const start = centre - part.size[along]! / 2, end = centre + part.size[along]! / 2;
  let low = start, high = end;
  while (exposed(low) && low < centre) low += BEAM_TRIM_STEP;
  while (exposed(high) && high > centre) high -= BEAM_TRIM_STEP;
  // Untouched, or so exposed that it is not a beam under this roof: leave it as authored.
  if ((low === start && high === end) || high - low < part.size[along]! / 2) return part;
  const position = [...part.position] as Point3, size = [...part.size] as Point3;
  position[along] = (low + high) / 2;
  size[along] = high - low;
  return { ...part, position, size };
};

/** Ridge, end tiles and (High) hip tiles curling up at each corner, all on the rendered mesh. */
const roofTiles = (context: KitContext, frame: Frame, tint: Point3, ornament: Partial<BuildingPart>) => {
  const { add, detailed } = context;
  const ridgeEnds = [frame.point(0, -.25, detailed), frame.point(0, .25, detailed)];
  runBetween(add, ridgeEnds[0]!, ridgeEnds[1]!, [.11, .07], { shape: "bevel-box", tint });
  // Lean buildings on Minimal keep the ridge but not its end blocks.
  if (detailed || !context.lean) for (const end of ridgeEnds) add({ position: [end[0], end[1] + .05, end[2]], shape: "bevel-box",
    size: [.1, .15, .14], stage: 4, surface: "roof", tint, ...ornament });
  if (!detailed) return;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const points = HIP_STOPS.map(t => frame.point(sx * .5 * t, sz * (.25 + .25 * t), true));
    for (let index = 1; index < points.length; index++) runBetween(add, points[index - 1]!, points[index]!, [.07, .05], { tint });
    const corner = points.at(-1)!;
    const tip: Point3 = [corner[0], corner[1] + .12, corner[2]];
    runBetween(add, corner, tip, [.06, .05], { tint, ...ornament });
    // Eight sides read as round at this size and keep the many hip tips cheap.
    add({ position: [tip[0], tip[1] + .04, tip[2]], radialSegments: 8, shape: "cone", size: [.045, .08, .045], stage: 4,
      surface: "roof", tint, ...ornament });
  }
};

/** The tiled roof with its soffit board and rafters underneath. */
const addJapaneseRoof = (context: KitContext, roof: BuildingPart) => {
  context.add(roof);
  // Lean (heavy) buildings keep the soffit board but not its rafters, to stay within budget.
  const rafters = context.detailed && !context.lean;
  for (const part of japaneseRoofUnderside(roof, japaneseRoofClass(context.typeId), rafters)) context.add(part);
};
/** A smaller upper tier on a short drum: the tower reads as a two-storey pagoda. */
const pagodaTier = (context: KitContext, frame: Frame, tint: Point3) => {
  const top = frame.point(0, 0, context.detailed)[1], drum = .22;
  context.add({ position: [frame.base[0], top + drum / 2 - .04, frame.base[2]], shape: "box",
    size: [frame.across * .42, drum, frame.length * .42], stage: 4, surface: "wood" });
  const height = frame.height * .7;
  addJapaneseRoof(context, { position: [frame.base[0], top + drum - .06 + height / 2, frame.base[2]],
    roofProfile: "japanese", rotation: frame.turned ? [0, Math.PI / 2, 0] : undefined, shape: "nation-roof",
    size: [frame.across * .62, height, frame.length * .62], stage: 4, surface: "roof", tint });
};

/** Swept hip roof in its building's colour class, with tiles; towers get a pagoda tier. */
export const japaneseRoof = (context: KitContext, roof: RoofEnvelope, main: boolean, wallPlateHeight?: number) => {
  if (useJapaneseTransferredHip(context.typeId, roof, main)) {
    addJapaneseTransferredHip(context, roof);
    return;
  }
  const frame = roofFrame(roof, wallPlateHeight), roofClass = japaneseRoofClass(context.typeId);
  const tint = JAPANESE_ROOF_TINTS[roofClass];
  const ornament: Partial<BuildingPart> = roofClass === "vermilion" ? { surface: "gold", tint: undefined } : {};
  addJapaneseRoof(context, { position: [frame.base[0], frame.base[1] + frame.height / 2 - .02, frame.base[2]],
    roofProfile: "japanese", rotation: frame.turned ? [0, Math.PI / 2, 0] : undefined, shape: "nation-roof",
    size: [frame.across, frame.height, frame.length], stage: 4, surface: "roof", tint });
  roofTiles(context, frame, tint, ornament);
  if (main && context.tower) pagodaTier(context, frame, tint);
};

export const japaneseDoor = (context: KitContext) => timberDoorFrame(context.add, context.door, "wood");
