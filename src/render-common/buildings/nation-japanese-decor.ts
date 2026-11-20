import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { withRoofFlagMount } from "./nation-flag-roof-mount";
import {
  createJapaneseDecorSite, HEAD_HEIGHT, insidePlot, isFree,   type JapaneseDecorSite,
occupy, partBounds, plotBox, roofPoint, roofUnit, soffitY} from "./nation-japanese-decor-sites";
import {
  BAMBOO_CLUMP_RADIUS, bambooClump, bambooFence, coiledDragon, lanternReach, paperLantern, shimenawa,
  sugidama, wallFan
} from "./nation-japanese-props";
import {
type Bounds, type DecorSite,
  faceBox, facePoint, faceSize, findWallFaces, fitsSite, isBacked, overlaps,   type WallFace
} from "./nubian-decor-faces";

/**
 * Japanese decor per occupation (owner request 2026-10-12): paper lanterns under the eaves, bamboo
 * stands, fences and banner poles, folding fans on walls, shrine details (shimenawa ropes, the
 * brewer's cedar ball) and dragons coiled round porch columns.
 */
type Feature = "bamboo" | "dragons" | "door-rope" | "fan" | "fence" | "lanterns" | "porch-rope" |
  "sugidama" | "well-rope";
interface DecorPlan { features: readonly Feature[]; minimal?: readonly Feature[] }

const GUARDS: DecorPlan = { features: ["lanterns", "fan"] };
const CRAFTS: DecorPlan = { features: ["lanterns", "fan", "bamboo"] };
const FIELDS: DecorPlan = { features: ["lanterns", "fence", "bamboo"] };
const MINES: DecorPlan = { features: ["door-rope", "lanterns", "bamboo"] };

/**
 * Measured against the 10,000 High / 2,300 Minimal budgets (tools/bench/nation-building-budget.ts).
 * The Mill has its own redesign; the Tavern already hangs red lanterns and a parasol.
 */
const DECOR_PLANS: Readonly<Record<number, DecorPlan>> = {
  0: { features: ["dragons", "lanterns"], minimal: ["dragons"] },
  1: GUARDS, 2: GUARDS, 3: CRAFTS, 4: { features: ["lanterns"] }, 5: FIELDS,
  6: { features: ["sugidama", "lanterns", "bamboo"] }, 8: CRAFTS,
  9: { features: ["lanterns", "fan"] }, 10: MINES, 11: MINES, 12: MINES, 13: MINES,
  14: { features: ["lanterns"] }, 15: CRAFTS,
  17: { features: ["bamboo"] }, 18: { features: ["lanterns", "bamboo"] }, 19: { features: ["door-rope", "bamboo"] },
  20: { features: ["fence", "bamboo"] }, 21: CRAFTS, 22: { features: ["lanterns", "bamboo"] },
  23: { features: ["sugidama", "lanterns"], minimal: ["sugidama"] }, 24: GUARDS,
  25: { features: ["fan", "lanterns"], minimal: ["fan"] }, 26: CRAFTS,
  27: { features: ["lanterns"] }, 28: FIELDS, 29: { features: ["lanterns", "dragons"] },
  32: { features: ["lanterns", "fan"] }, 33: CRAFTS, 34: { features: ["dragons", "lanterns", "fan"] },
  35: { features: ["well-rope", "bamboo"] }, 36: { features: ["lanterns", "bamboo"] },
  37: { features: ["fence"] },
  39: { features: ["lanterns"] }, 40: { features: ["bamboo"] }
};


type Placer = (site: JapaneseDecorSite, faces: readonly WallFace[], typeId: number) => readonly BuildingPart[];

/** Hang points near an eave corner (unit roof coordinates, 0.49 is the eave edge), the tip first. */
const EAVE_SPOTS = [[.49, .49], [.49, .42], [.42, .49], [.49, .34], [.34, .49]] as const;
const LANTERN_HALF = .06;

/** Bounds of a roof part and its soffit and rafter layers (same placement). */
const roofLayers = (site: JapaneseDecorSite, roof: BuildingPart) => site.recipe.parts
  .filter(part => part.shape === "nation-roof" && part.position.every((value, axis) => value === roof.position[axis]))
  .map(partBounds);

/** Cord length: the lantern's foot stays above head height where the eave allows. */
const lanternDrop = (hang: number) => Math.min(.12, Math.max(.03, hang - HEAD_HEIGHT - .2));

/** A lantern from the soffit at a unit roof point, if it hangs free (stage 4 trims above it are fine). */
const hangLantern = (site: JapaneseDecorSite, roof: BuildingPart, x: number, z: number) => {
  const hang = roofPoint(roof, x, z, soffitY(roof, x, z)), drop = lanternDrop(hang[1]);
  const box = plotBox(hang[0], hang[2], LANTERN_HALF, hang[1] - lanternReach(drop), hang[1] - .01);
  const above = site.boxes.filter(other => other.min[1] >= hang[1] - .06);
  return isFree(box, site, [...roofLayers(site, roof), ...above]) ? paperLantern(hang, drop) : null;
};

const roofArea = (roof: BuildingPart) => roof.size[0] * roof.size[2];
/** The roof reaching furthest forward: its front corners frame the entrance. */
const frontRoof = (site: JapaneseDecorSite) => [...site.roofs].sort((a, b) =>
  partBounds(b).max[2] - partBounds(a).max[2] || roofArea(b) - roofArea(a))[0];

/** Corners of a roof as unit signs, the two at the world front first. */
const cornersByFront = (roof: BuildingPart) => [[-1, -1], [-1, 1], [1, -1], [1, 1]]
  .map(([sx, sz]) => ({ sx: sx!, sz: sz!, z: roofPoint(roof, sx! * .5, sz! * .5, 0)[2] }))
  .sort((a, b) => b.z - a.z);

const eaveLantern = (site: JapaneseDecorSite, roof: BuildingPart, sx: number, sz: number) => {
  for (const [x, z] of EAVE_SPOTS) {
    const lantern = hangLantern(site, roof, sx * x, sz * z);
    if (lantern) return lantern;
  }
  return null;
};

const BRACKET_REACH = .18;

/** What hangs from a wall bracket: half width, reach below the arm and the parts at a hang point. */
interface Hanging { half: number; reach: number; parts: (hang: Point3) => BuildingPart[] }
const LANTERN_DROP = .03;
const BRACKET_LANTERN: Hanging = { half: LANTERN_HALF, parts: hang => paperLantern(hang, LANTERN_DROP),
  reach: lanternReach(LANTERN_DROP) };
const SUGIDAMA_DIAMETER = .18;
const BRACKET_SUGIDAMA: Hanging = { half: SUGIDAMA_DIAMETER / 2 + .01,
  parts: hang => sugidama(hang, .05, SUGIDAMA_DIAMETER), reach: .05 + SUGIDAMA_DIAMETER };

/**
 * A wooden wall bracket (an arm with a diagonal brace) carrying a lantern or cedar ball where
 * the eaves are too short to hang one: on a front wall, from `outer` towards the wall's middle.
 */
const bracketHang = (site: JapaneseDecorSite, face: WallFace, outer: number, hanging: Hanging) => {
  const inward = outer > (face.from + face.to) / 2 ? -1 : 1, reach = Math.max(BRACKET_REACH, hanging.half * 2 + .06);
  for (let along = outer + inward * .12; Math.abs(along - outer) < .5; along += inward * .06) {
    const arm = face.top - .12, hang = facePoint(face, along, arm - .012, reach - hanging.half - .01);
    const occupied = faceBox(face, [along - hanging.half, along + hanging.half],
      [arm - .012 - hanging.reach, arm + .015], [.03, reach + .045]);
    if (!fitsSite(face, occupied, decorSite(site)) || !isBacked(face, occupied, decorSite(site))) continue;
    return [wallArm(face, along, arm, reach), wallBrace(face, along, arm, reach), ...hanging.parts(hang)];
  }
  return null;
};

const wallArm = (face: WallFace, along: number, y: number, reach: number): BuildingPart => ({
  position: facePoint(face, along, y, reach / 2 - .005), shape: "box", size: faceSize(face, .026, .026, reach + .01),
  stage: 3, surface: "wood" });

/** Diagonal brace from the wall up to the arm's middle. */
const wallBrace = (face: WallFace, along: number, y: number, reach: number): BuildingPart => {
  const from = facePoint(face, along, y - .1, 0), to = facePoint(face, along, y - .01, reach * .55);
  const length = DMath.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const tilt = DMath.atan2(reach * .55, .09);
  const rotation: Point3 = face.axis === 0 ? [0, 0, -face.sign * tilt] : [face.sign * tilt, 0, 0];
  return { position: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2], rotation, shape: "box",
    size: [.02, length, .02], stage: 3, surface: "wood" };
};

/**
 * Two lanterns framing the entrance: from the front corners of the front roof where its eaves
 * reach far enough, otherwise on wall brackets at the outer ends of the front wall.
 */
const placeLanterns: Placer = (site, faces) => {
  const roof = frontRoof(site), fronts = faces.filter(face => face.side === "front");
  const corners = roof ? cornersByFront(roof).slice(0, 2) : [];
  return [-1, 1].flatMap(side => {
    const corner = corners.find(({ sx, sz }) => Math.sign(roofPoint(roof!, sx * .5, sz * .5, 0)[0] - site.doorCenter) === side);
    const hung = corner ? eaveLantern(site, roof!, corner.sx, corner.sz) : null;
    if (hung) return occupy(site, hung);
    const face = fronts.filter(front => Math.sign((front.from + front.to) / 2 - site.doorCenter) === side)
      .sort((a, b) => (b.to - b.from) - (a.to - a.from))[0];
    const bracketed = face ? bracketHang(site, face, side > 0 ? face.to : face.from, BRACKET_LANTERN) : null;
    return bracketed ? occupy(site, bracketed) : [];
  });
};

/** Faces ranked for wall and ground props: sides and front (seen in the gameplay view), then back. */
const SIDE_ORDER: Readonly<Record<WallFace["side"], number>> = { back: 2, front: 1, side: 0 };
const rankedFaces = (faces: readonly WallFace[]) =>
  [...faces].sort((a, b) => SIDE_ORDER[a.side] - SIDE_ORDER[b.side] || (b.to - b.from) - (a.to - a.from));

const decorSite = (site: JapaneseDecorSite): DecorSite =>
  ({ boxes: site.boxes, limit: site.limit, recipe: site.recipe, walls: site.walls });

/** Spots along a face, middle first. */
const alongSpots = (face: WallFace, margin: number) => {
  const middle = (face.from + face.to) / 2, spots: number[] = [];
  for (let offset = 0; offset <= (face.to - face.from) / 2 - margin; offset += .05) spots.push(middle - offset, middle + offset);
  return spots;
};

const FAN_RADIUS = .15;
/** A folding fan on a free stretch of plastered wall, between the frame's posts and beams. */
const placeFan: Placer = (site, faces) => {
  for (const face of rankedFaces(faces)) for (const along of alongSpots(face, FAN_RADIUS + .03))
    for (const level of [.62, .5, .4]) {
      const hub = face.base + (face.top - face.base) * level;
      const box = faceBox(face, [along - FAN_RADIUS, along + FAN_RADIUS], [hub - .01, hub + FAN_RADIUS * 1.04],
        [.001, .03]);
      if (!fitsSite(face, box, decorSite(site)) || !isBacked(face, box, decorSite(site))) continue;
      return occupy(site, [wallFan(facePoint(face, along, hub, .012), face.yaw, FAN_RADIUS)]);
    }
  return [];
};

/** Bamboo clump heights to try: full grove height, then short enough to stand under the eaves. */
const BAMBOO_SCALES = [1, .62, .45];
/** Leaf sprays reach about this far round the clump. */
const BAMBOO_CANOPY = .2;

/** A bamboo stand on the ground beside a side or back wall. */
const placeBamboo: Placer = (site, faces) => {
  for (const scale of BAMBOO_SCALES) for (const face of rankedFaces(faces))
    for (const along of alongSpots(face, .05)) for (const out of [.2, .3, .15]) {
      const centre = facePoint(face, along, 0, out), top = 1.33 * scale + .02;
      const ground = plotBox(centre[0], centre[2], BAMBOO_CLUMP_RADIUS, 0, top);
      const canopy = plotBox(centre[0], centre[2], BAMBOO_CANOPY * (.5 + scale / 2), top * .62, top);
      if (!isFree(ground, site) || !isFree(canopy, site)) continue;
      // Leaning culms carry their leaves a little past the canopy circle: all must stay on the plot.
      const clump = bambooClump(centre, site.detailed, scale);
      if (clump.every(part => insidePlot(partBounds(part), site.limit))) return occupy(site, clump);
    }
  return [];
};

const FENCE_MIN = .7;
const FENCE_MAX = 1.3;

/** A low bamboo fence along the longest free run beside a side or back wall. */
const placeFence: Placer = (site, faces) => {
  for (const face of rankedFaces(faces).filter(face => face.side !== "front")) for (const out of [.28, .4]) {
    let best: [number, number] | null = null;
    for (let start = face.from; start < face.to - FENCE_MIN; start += .05) {
      let end = start + FENCE_MIN;
      const fits = (to: number) => isFree(faceBox(face, [start, to], [0, .48], [out - .04, out + .04]), site);
      if (!fits(end)) continue;
      while (end + .05 <= Math.min(face.to, start + FENCE_MAX) && fits(end + .05)) end += .05;
      if (!best || end - start > best[1] - best[0]) best = [start, end];
    }
    if (!best) continue;
    const outward: Point3 = [0, 0, 0];
    outward[face.axis] = face.sign;
    return occupy(site, bambooFence(facePoint(face, best[0], 0, out), facePoint(face, best[1], 0, out), outward,
      site.detailed));
  }
  return [];
};

/** Shimenawa across the door frame's lintel, its shide outside the door leaf's sweep. */
const placeDoorRope: Placer = site => {
  const { recipe } = site, width = recipe.doorDimensions?.width ?? .46;
  const y = site.doorTop + .07, z = recipe.door[2] + .07 + .024;
  const from: Point3 = [recipe.door[0] - .06, y, z], to: Point3 = [recipe.door[0] + width + .06, y, z];
  const box: Bounds = { max: [to[0], y + .03, z + .03], min: [from[0], y - .14, z - .02] };
  // The rope rests on the lintel's face: only parts other than the door frame may not be in the way.
  const frame = site.boxes.filter(other => other.max[1] <= y + .06 && other.min[2] < recipe.door[2] + .08 &&
    other.max[2] > recipe.door[2] - .08 && other.min[0] >= from[0] - .12 && other.max[0] <= to[0] + .12);
  // A mine's hollow vault (curved masonry) stands behind the portal, never in front of the lintel.
  const vaults = recipe.parts.filter(part => part.shape === "stone-arc").map(partBounds);
  const blocking = site.boxes.filter(other => !frame.includes(other) && !vaults.some(vault => sameBounds(vault, other)));
  if (!insideLimit(box, site) || blocking.some(other => overlaps(other, box, .005))) return [];
  return occupy(site, shimenawa(from, to, .035, .048, site.detailed));
};

const sameBounds = (a: Bounds, b: Bounds) =>
  [0, 1, 2].every(axis => a.min[axis] === b.min[axis] && a.max[axis] === b.max[axis]);

const insideLimit = (box: Bounds, site: JapaneseDecorSite) =>
  Math.max(Math.abs(box.min[0]), Math.abs(box.max[0])) <= site.limit.extentX &&
  Math.max(Math.abs(box.min[2]), Math.abs(box.max[2])) <= site.limit.extentZ;

/** The well frame's front crossbeam: the highest timber spanning the well in front of its winch. */
const wellBeam = (site: JapaneseDecorSite) => site.recipe.parts.filter(part => part.shape === "box" &&
  part.surface === "wood" && !part.rotation && part.size[0] > .6 && part.position[1] > .9 &&
  part.position[2] > site.recipe.mechanism[2]).sort((a, b) => b.position[2] - a.position[2])[0];

/**
 * Shimenawa of a sacred well, draped across the front of the frame's crossbeam and post: tied at
 * both ends to the beam's face, high above the winch and the drawing worker.
 */
const placeWellRope: Placer = site => {
  const beam = wellBeam(site);
  if (!beam) return [];
  const bounds = partBounds(beam), thickness = .048, half = beam.size[0] / 2 - .05;
  const y = bounds.min[1] + thickness * .3, z = bounds.max[2] + thickness / 2 + .004;
  return occupy(site, shimenawa([beam.position[0] - half, y, z], [beam.position[0] + half, y, z], .05, thickness,
    site.detailed));
};

/** A porch beam in front of the door spanning its lane: the shimenawa hangs under it. */
const porchBeam = (site: JapaneseDecorSite) => site.recipe.parts.filter(part => part.shape === "box" &&
  !part.rotation && part.size[0] > 1 && part.size[1] < .2 && part.size[2] < .3 && part.position[1] > .9 &&
  part.position[2] > site.recipe.door[2] + .2 && Math.abs(part.position[0] - site.doorCenter) < part.size[0] / 2 - .4)
  .sort((a, b) => b.position[2] - a.position[2])[0];

/** Shimenawa under the porch beam, between the columns flanking the entrance. */
const placePorchRope: Placer = site => {
  const beam = porchBeam(site);
  if (!beam) return [];
  const bounds = partBounds(beam), thickness = .055, y = bounds.min[1] - thickness * .45;
  const half = Math.min(beam.size[0] / 2 - .1, .52), z = beam.position[2] + beam.size[2] / 2 - thickness;
  const from: Point3 = [site.doorCenter - half, y, z], to: Point3 = [site.doorCenter + half, y, z];
  return occupy(site, shimenawa(from, to, .07, thickness, site.detailed));
};

/** Upright round columns standing on the ground: porch and portico posts a dragon can coil round. */
const columns = (site: JapaneseDecorSite) => site.recipe.parts.filter(part => part.shape === "cylinder" &&
  !part.rotation && !part.stock && part.size[1] > .8 && part.size[0] >= .06 && part.size[0] <= .2 &&
  part.position[1] - part.size[1] / 2 < .25);

/** Dragons on the front-most column on each side of the entrance, looking out towards visitors. */
const placeDragons: Placer = (site, _faces, typeId) => {
  const posts = columns(site).sort((a, b) => b.position[2] - a.position[2]);
  // The Storehouse's inner lean-to post is too close to its wall for the raised dragon head.
  const columnOrder = typeId === 29 ? -1 : 1;
  return [-1, 1].flatMap(side => {
    const post = posts.filter(part => Math.sign(part.position[0] - site.doorCenter) === side)
      .sort((a, b) => b.position[2] - a.position[2] ||
        columnOrder * (Math.abs(a.position[0]) - Math.abs(b.position[0])))[0];
    if (!post) return [];
    const bottom = post.position[1] - post.size[1] / 2 + .12, top = post.position[1] + post.size[1] / 2 - .1;
    return occupy(site, [coiledDragon({ radius: post.size[0] / 2, x: post.position[0], z: post.position[2] }, bottom,
      top, -side * .55)]);
  });
};

/** The brewer's cedar ball under the front eave beside the door, or on a wall bracket. */
const placeSugidama: Placer = (site, faces) => {
  const roof = frontRoof(site), { recipe } = site;
  if (roof) for (const side of [1, -1]) for (const reach of [.5, .62, .75, .9]) for (const out of [.16, .1, .22]) {
    const x = site.doorCenter + side * reach, z = recipe.door[2] + out, unit = roofUnit(roof, x, z);
    if (Math.abs(unit.x) > .46 || Math.abs(unit.z) > .46) continue;
    const hang = soffitY(roof, unit.x, unit.z), box = plotBox(x, z, .11, hang - .32, hang - .01);
    if (!isFree(box, site, roofLayers(site, roof))) continue;
    return occupy(site, sugidama([x, hang, z], .08));
  }
  // Short eaves: on a bracket on the front wall, else near the front corner of a side wall.
  for (const face of rankedFaces(faces).filter(wall => wall.side !== "back").reverse()) {
    // Front walls: from the end away from the door; side walls: from the front corner (largest z).
    const awayFromDoor = Math.abs(face.to - site.doorCenter) < Math.abs(face.from - site.doorCenter) ? face.from : face.to;
    const outer = face.side === "front" ? awayFromDoor : face.to;
    const hung = bracketHang(site, face, outer, BRACKET_SUGIDAMA);
    if (hung) return occupy(site, hung);
  }
  return [];
};

const PLACERS: Readonly<Record<Feature, Placer>> = {
  bamboo: placeBamboo, dragons: placeDragons, "door-rope": placeDoorRope, fan: placeFan, fence: placeFence,
  lanterns: placeLanterns, "porch-rope": placePorchRope, sugidama: placeSugidama,
  "well-rope": placeWellRope
};

/** Each planned feature of a building with the parts placed for it (empty when nothing fits). */
const planJapaneseDecor = (recipe: BuildingRecipe, definition: BuildingDefinition, detailed: boolean,
  limit: DecorSite["limit"]) => {
  const plan = DECOR_PLANS[definition.id];
  if (!plan) return [];
  const { faces, walls } = findWallFaces(recipe.parts);
  const site = createJapaneseDecorSite(recipe, detailed, limit, definition.mechanism !== "none", walls);
  const features = detailed ? plan.features : plan.minimal ?? plan.features;
  return features.map(feature => ({ feature, parts: PLACERS[feature](site, faces, definition.id) }));
};

/**
 * Adds each occupation's Japanese decor to a finished nation recipe. Every prop hangs from an
 * eave, rests on a wall, column or lintel, or stands on the ground, inside the plot envelope and
 * clear of the door lane, worker walks, mechanisms, flag and stock.
 */
export const addJapaneseDecor = (recipe: BuildingRecipe, definition: BuildingDefinition, detailed: boolean,
  limit: DecorSite["limit"]): BuildingRecipe => {
  const added = planJapaneseDecor(recipe, definition, detailed, limit).flatMap(({ parts }) => parts);
  const decorated = added.length ? { ...recipe, parts: [...recipe.parts, ...added] } : recipe;
  return [1, 2].includes(definition.id) ? withRoofFlagMount(decorated, detailed) : decorated;
};
