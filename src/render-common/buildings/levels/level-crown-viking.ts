import type { BuildingPart, Point3 } from "../building-recipe";
import { getRomanPartBounds } from "../building-recipe-fit";
import { addCloth, addEmblem, addPole, bannerPole, poleTop } from "./level-banner";
import { crownPoint, crownScale, footprintFloor } from "./level-crown-roman";
import type { DormerStyle } from "./level-dormer";
import { mayCarryFlag } from "./level-flag-policy";
import { type Box, boxOf, heightCap, isFree, type LevelKit, ridgeHalfLength } from "./level-kit";
import { isLeanPiece } from "./level-lean";
import { addLeanToStore } from "./level-lean-to";
import { isRoofSpotFree, ridgeAxisOf } from "./level-roof-pieces";
import { isRoofCovering } from "./level-roof-surface";
import { addRoofVentWindow } from "./level-roof-vent";
import { findRoundShafts } from "./level-site";
import { addShaftBanner, BANNER_COLOURS } from "./level-wall-pieces";

/** Ridge turret at full size: drum, steep pyramid roof and the finial (military/HQ: weathervane) above it. */
const TURRET = { drum: .24, roof: .34, vane: .2, width: .28 } as const;
const TURRET_HEIGHT = TURRET.drum + TURRET.roof + TURRET.vane;

/** Crossed barge boards ending in turned finials over the dormer gable. */
export const VIKING_DORMER: DormerStyle = { gable: "planks", wall: "planks", window: "shuttered",
  ornament: (kit, apex, out) => {
    for (const side of [-1, 1]) {
      const tip: Point3 = [...apex];
      tip[out[0] ? 2 : 0] += side * .05;
      kit.add({ position: [tip[0], tip[1] + .04, tip[2]], rotation: out[0] ? [side * .5, 0, 0] : [0, 0, -side * .5],
        shape: "bevel-box", size: [.035, .14, .035], stage: 4, surface: "wood" });
    }
  } };

/** Smallest share of the full turret height that still reads as a turret (with its vane). */
const MIN_SCALE = .55;
/**
 * A cramped ridge (low height cap) takes a squat ljóri instead: the full height share it may shrink
 * to, and the plan width it keeps so it never turns into a thin stick.
 */
const SQUAT_SCALE = .38;
const SQUAT_WIDTH_SCALE = .75;
/** Plan width of a slim turret, tried where the full drum would touch a monitor or a gable dragon. */
const SLIM_WIDTH = TURRET.width * SQUAT_WIDTH_SCALE;
/** Steps along the ridge tried when the ridge centre is taken (a level 4 monitor, a chimney, a tower). */
const RIDGE_STEP = .05;

export interface TurretFit { at: Point3; scale: number; width: number }

/** Ridge points from `centre` outward along `axis`, the camera-side (positive) end first at each distance. */
const ridgeSpots = (kit: LevelKit, centre: Point3, axis = ridgeAxisOf(kit), reach = ridgeHalfLength(kit.site)) => {
  const spots: Point3[] = [centre];
  for (let along = RIDGE_STEP; along <= reach; along += RIDGE_STEP) for (const side of [1, -1]) {
    const spot: Point3 = [...centre];
    spot[axis] += side * along;
    const ridge = kit.site.topAt(spot[0], spot[2]);
    if (ridge === null) continue;
    spot[1] = ridge;
    spots.push(spot);
  }
  return spots;
};

/** A ridge this far below or above the crown is no longer the same level ridge. */
const LEVEL_RIDGE = .035;

/**
 * The level ridge through the crown running across the declared ridge axis (a hall whose roof
 * envelope also takes in a taller tower is read along the wrong axis): its middle and half length.
 */
const crossRidge = (kit: LevelKit, crown: Point3) => {
  const axis: 0 | 2 = ridgeAxisOf(kit) === 0 ? 2 : 0, ends = [0, 0];
  for (const [index, side] of [[0, -1], [1, 1]] as const) for (let along = RIDGE_STEP; ; along += RIDGE_STEP) {
    const point: Point3 = [...crown];
    point[axis] += side * along;
    const ridge = kit.site.topAt(point[0], point[2]);
    if (ridge === null || Math.abs(ridge - crown[1]) > LEVEL_RIDGE) break;
    ends[index] = side * along;
  }
  const middle: Point3 = [...crown];
  middle[axis] += (ends[0]! + ends[1]!) / 2;
  return { axis, middle, reach: (ends[1]! - ends[0]!) / 2 };
};

/** A turret moved off the centre stands on the level ridge: its drum never hangs past a hip or gable end. */
const isOnLevelRidge = (kit: LevelKit, at: Point3, half: number, axis: 0 | 2) =>
  [-1, 1].every(side => {
    const end: Point3 = [...at];
    end[axis] += side * half;
    const ridge = kit.site.topAt(end[0], end[2]);
    return ridge !== null && ridge >= at[1] - LEVEL_RIDGE;
  });

/**
 * Small roof pieces raised over the ridge (level 4 monitors, chimney caps) are roof coverings,
 * which `isRoofSpotFree` lets a piece rest in; a ridge piece beside them must still keep clear of
 * them. Ridge boards and logs running the whole roof are what it stands on.
 */
const RAISED = .02;
const SPANNING = 1.5;
const isRaisedRoofPiece = (part: BuildingPart, bounds: Box, ridge: number) => isRoofCovering(part) &&
  bounds.min[1] > ridge + RAISED && Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]) < SPANNING;

const overlaps = (a: Box, b: Box, margin: number) => [0, 1, 2].every(axis =>
  a.min[axis]! < b.max[axis]! + margin && a.max[axis]! > b.min[axis]! - margin);

interface RidgePiece {
  /** The piece's own storeys, kept clear of raised roof pieces. */
  body: readonly Box[];
  /** The clear space it keeps from ornaments, chimneys and crowns. */
  clearance: Point3;
  /** A raised roof piece it stands on (a level 4 monitor). */
  standsOn?: BuildingPart;
}

/**
 * True when a ridge piece standing on the ridge at `ridge` touches no ornament, chimney, monitor
 * or crown (except the piece it stands on).
 */
const isRidgeSpotFree = (kit: LevelKit, centre: Point3, ridge: number, { body, clearance, standsOn }: RidgePiece) => {
  if (!isRoofSpotFree(kit, centre, clearance, ridge)) return false;
  return kit.site.parts.every(part => {
    if (part === standsOn) return true;
    const bounds = getRomanPartBounds(part);
    return !isRaisedRoofPiece(part, bounds, ridge) || body.every(box => !overlaps(bounds, box, RAISED));
  });
};

/**
 * The first ridge point (centre first) with room for a turret: its own width everywhere, then slim;
 * failing that, along a level ridge running across the declared axis (from its middle).
 */
const findTurretFit = (kit: LevelKit, crown: Point3) => {
  const declared = fitAlong(kit, ridgeSpots(kit, crown), crown, ridgeAxisOf(kit));
  if (declared) return declared;
  const { axis, middle, reach } = crossRidge(kit, crown);
  if (reach < RIDGE_STEP) return null;
  const top = kit.site.topAt(middle[0], middle[2]);
  if (top === null) return null;
  const centre: Point3 = [middle[0], top, middle[2]];
  return fitAlong(kit, ridgeSpots(kit, centre, axis, reach), null, axis);
};

/** The first spot (full width everywhere, then slim) a turret fits; `centre` needs no level ridge check. */
const fitAlong = (kit: LevelKit, spots: readonly Point3[], centre: Point3 | null, axis: 0 | 2) => {
  for (const slim of [false, true]) for (const spot of spots) {
    const fit = turretFitAt(kit, spot, spot === centre, slim, axis);
    if (fit) return fit;
  }
  return null;
};

/** Drum width at a ridge point: the turret's own (scaled) width, or the slim one; null when it is no slimmer. */
const turretWidth = (scale: number, slim: boolean) => {
  const width = TURRET.width * (scale < MIN_SCALE ? SQUAT_WIDTH_SCALE : scale);
  if (!slim) return width;
  return width > SLIM_WIDTH ? SLIM_WIDTH : null;
};

/** The drum and the spire, whose eave overhangs the drum by 0.06 each side. */
const turretStoreys = ([x, ridge, z]: Point3, scale: number, width: number) => {
  const eave = ridge + TURRET.drum * scale, spire = TURRET.roof * scale + .04;
  return [boxOf([x, (ridge + eave) / 2, z], [width, eave - ridge, width]),
    boxOf([x, eave + spire / 2, z], [width + .12, spire, width + .12])];
};

/** Turret size at a ridge point: full or scaled to the height cap, squat or slim when cramped, else null. */
const turretFitAt = (kit: LevelKit, at: Point3, onCentre: boolean, slim: boolean, axis: 0 | 2): TurretFit | null => {
  const scale = crownScale(kit, at[1], TURRET_HEIGHT);
  if (scale < SQUAT_SCALE) return null;
  const height = TURRET_HEIGHT * scale, width = turretWidth(scale, slim);
  if (width === null || !onCentre && !isOnLevelRidge(kit, at, width / 2 + .04, axis)) return null;
  const free = isRidgeSpotFree(kit, [at[0], at[1] + height / 2, at[2]], at[1],
    { body: turretStoreys(at, scale, width), clearance: [width + .1, height, width + .1] });
  return free ? { at, scale, width } : null;
};

/** Turret drum: a plank box with four corner posts and slatted smoke openings, closed down onto the slopes. */
const turretDrum = (kit: LevelKit, { at, scale, width }: TurretFit) => {
  const [x, ridge, z] = at, drum = TURRET.drum * scale;
  const floor = footprintFloor(kit, at, width / 2) - .02, eave = ridge + drum;
  const openingBottom = ridge + drum * .38, openingTop = ridge + drum * .78;
  kit.add({ position: [x, (floor + openingBottom) / 2, z], shape: "box",
    size: [width, openingBottom - floor, width], stage: 4,
    surface: "planks" });
  kit.add({ position: [x, (openingTop + eave) / 2, z], shape: "box",
    size: [width, eave - openingTop, width], stage: 4, surface: "planks" });
  const corner = width * .275, middle = (openingBottom + openingTop) / 2;
  for (const dx of [-1, 1]) for (const dz of [-1, 1])
    kit.add({ position: [x + dx * (width - corner) / 2, middle, z + dz * (width - corner) / 2],
      shape: "box", size: [corner, openingTop - openingBottom, corner], stage: 4, surface: "planks" });
  for (const axis of [0, 2] as const) for (const side of [-1, 1]) {
    const face: Point3 = [x, middle, z], out: Point3 = [0, 0, 0];
    face[axis] += side * width / 2; out[axis] = side;
    addRoofVentWindow(kit, face, out, width * .45, openingTop - openingBottom);
  }
  return eave;
};

/**
 * Ridge turret (ljóri): a plank drum with smoke openings under a steep shingled spire, crowned by a
 * gilded finial; only military buildings and the HQ carry the weathervane (owner rule 2026-11-08).
 */
const ridgeTurret = (kit: LevelKit, fit: TurretFit) => {
  const { at: [x, , z], scale, width } = fit, eave = turretDrum(kit, fit);
  kit.add({ position: [x, eave + .02, z], shape: "bevel-box", size: [width + .06, .04, width + .06], stage: 4,
    surface: "wood" });
  const spire = TURRET.roof * scale, tip = eave + .04 + spire;
  kit.add({ position: [x, eave + .04 + spire / 2, z], radialSegments: 4, rotation: [0, Math.PI / 4, 0], shape: "cone",
    size: [(width + .12) * Math.SQRT2, spire, (width + .12) * Math.SQRT2], stage: 4, surface: "roof" });
  if (scale < MIN_SCALE) {
    spireKnob(kit, [x, tip - .02, z]);
    return;
  }
  if (isLeanPiece(kit.site, "crown-ornaments")) return;
  if (mayCarryFlag(kit.site.definition.id)) weathervane(kit, [x, tip - .02, z], TURRET.vane * scale);
  else spireFinial(kit, [x, tip - .02, z]);
};

/** Gilded spire finial: a knob under a short spike (Minimal: the knob alone). */
const spireFinial = (kit: LevelKit, foot: Point3) => {
  spireKnob(kit, foot);
  if (!kit.detailed) return;
  const [x, y, z] = foot;
  kit.add({ position: [x, y + .075, z], radialSegments: 6, shape: "cone", size: [.03, .07, .03], stage: 4,
    surface: "gold" });
};

/** A squat ljóri has no room for the vane: a gilded knob caps its spire instead. */
const spireKnob = (kit: LevelKit, foot: Point3) => {
  const [x, y, z] = foot;
  kit.add({ position: [x, y + .02, z], shape: "sphere", size: [.04, .04, .04], stage: 4, surface: "gold",
    radialSegments: kit.detailed ? 6 : 4 });
};

/** Gilded quadrant vane on an iron rod, its curved edge toward the pole (as on Norse ship prows). */
const weathervane = (kit: LevelKit, foot: Point3, height: number, plate = 1) => {
  const axis = ridgeAxisOf(kit), [x, y, z] = foot, length = .13 * plate, depth = .09 * plate;
  kit.add({ position: [x, y + height / 2, z], radialSegments: 4, shape: "cylinder", size: [.016, height, .016],
    stage: 4, surface: "iron" });
  const vane: Point3 = [x, y + height * .66, z];
  vane[axis] += length / 2;
  kit.add({ position: vane, shape: "box", size: axis === 0 ? [length, depth, .008] : [.008, depth, length], stage: 4,
    surface: "gold" });
  if (kit.detailed) kit.add({ position: [x, y + height + .015, z], shape: "sphere", size: [.035, .035, .035],
    stage: 4, surface: "gold", radialSegments: 6 });
};

/**
 * Carved vane post: wanted height over its foot, the least that still reads, the post's share of
 * it and the vane plate's size (the turret vane's is 1: alone on the ridge it must read larger).
 */
const VANE_POST = { minimum: .26, plate: 1.5, post: .4, wanted: .42 } as const;
/** Plan box a vane post and its swinging plate keep clear. */
const VANE_REACH = .13 * VANE_POST.plate * 2 + .02;

/** Level 4 ridge monitors (raised roofs over the ridge) a vane post may stand on, highest first. */
const ridgeMonitors = (kit: LevelKit, crown: Point3) => kit.site.parts.filter(part => {
  if (part.shape !== "occupation-roof") return false;
  const bounds = getRomanPartBounds(part);
  return bounds.min[1] > crown[1] + RAISED && [0, 2].every(axis =>
    bounds.min[axis]! <= crown[axis]! && bounds.max[axis]! >= crown[axis]!);
}).sort((a, b) => getRomanPartBounds(b).max[1] - getRomanPartBounds(a).max[1]);

interface VaneSpot { foot: Point3; height: number; standsOn?: BuildingPart }

const vaneSpotAt = (kit: LevelKit, foot: Point3, standsOn?: BuildingPart): VaneSpot | null => {
  const height = Math.min(VANE_POST.wanted, heightCap(kit.site) - .02 - foot[1]);
  if (height < VANE_POST.minimum) return null;
  const centre: Point3 = [foot[0], foot[1] + height / 2 + .03, foot[2]];
  const reach: Point3 = [VANE_REACH, height, VANE_REACH];
  const free = isRidgeSpotFree(kit, centre, foot[1], { body: [boxOf(centre, reach)], clearance: reach, standsOn });
  return free ? { foot, height, standsOn } : null;
};

/** Plan step of the search for a tower roof standing over the main roof. */
const SAMPLE_STEP = .1;
/** A roof this much over the main ridge is a tower's own (a bell or look-out tower). */
const TOWER_RISE = .3;

/** Covered plan points within this of the highest one belong to the same (level) tower ridge. */
const RIDGE_TOLERANCE = .01;

/** Covered plan points of the roofs, with their heights. */
const roofSamples = (kit: LevelKit) => {
  const { extentX, extentZ } = kit.site.limit, samples: Point3[] = [];
  for (let x = -extentX; x <= extentX; x += SAMPLE_STEP) for (let z = -extentZ; z <= extentZ; z += SAMPLE_STEP) {
    const top = kit.site.topAt(x, z);
    if (top !== null) samples.push([x, top, z]);
  }
  return samples;
};

/** The middle of a tower roof's ridge standing over the main roof, if the building has such a tower. */
const towerRidgeMiddle = (kit: LevelKit, crown: Point3): Point3 | null => {
  const samples = roofSamples(kit), highest = Math.max(...samples.map(([, top]) => top));
  if (!(highest > crown[1] + TOWER_RISE)) return null;
  const ridge = samples.filter(([, top]) => top >= highest - RIDGE_TOLERANCE);
  const middle: Point3 = [ridge.reduce((sum, point) => sum + point[0], 0) / ridge.length, highest,
    ridge.reduce((sum, point) => sum + point[2], 0) / ridge.length];
  centreOnRidgeCap(kit, middle);
  const top = kit.site.topAt(middle[0], middle[2]);
  return top === null ? null : [middle[0], top, middle[2]];
};

/** Moves a point across onto the axis of the ridge cap (log or board) it lies on. */
const centreOnRidgeCap = (kit: LevelKit, point: Point3) => {
  const cap = kit.site.parts.find(part => {
    if (!isRoofCovering(part)) return false;
    const { max, min } = getRomanPartBounds(part);
    return Math.abs(max[1] - point[1]) < RIDGE_TOLERANCE && [0, 2].every(axis =>
      min[axis]! <= point[axis]! && max[axis]! >= point[axis]!);
  });
  if (!cap) return;
  const { max, min } = getRomanPartBounds(cap), across = max[0] - min[0] < max[2] - min[2] ? 0 : 2;
  point[across] = cap.position[across]!;
};

/** Where a vane post stands: on the level 4 ridge monitor, the main ridge (centre outward) or a tower's ridge. */
const findVaneSpot = (kit: LevelKit, crown: Point3) => {
  for (const monitor of ridgeMonitors(kit, crown)) {
    const top = getRomanPartBounds(monitor).max[1], [x, , z] = monitor.position;
    const spot = vaneSpotAt(kit, [x, top - .015, z], monitor);
    if (spot) return spot;
  }
  for (const ridge of ridgeSpots(kit, crown)) {
    const spot = vaneSpotAt(kit, ridge);
    if (spot) return spot;
  }
  const tower = towerRidgeMiddle(kit, crown);
  return tower && vaneSpotAt(kit, tower);
};

/** Where no turret fits: a turned post on the ridge carrying the gilded vane (a ship vane, as on Norse prows). */
const vanePost = (kit: LevelKit, { foot, height }: VaneSpot) => {
  const [x, y, z] = foot, post = height * VANE_POST.post;
  kit.add({ position: [x, y + post / 2 - .02, z], radialSegments: kit.detailed ? 8 : 4, shape: "cylinder",
    size: [.045, post + .04, .045], stage: 4, surface: "wood", topScale: [.7, 1, .7] });
  kit.add({ position: [x, y + post, z], radialSegments: kit.detailed ? 8 : 4, shape: "sphere",
    size: [.05, .04, .05], stage: 4, surface: "wood" });
  weathervane(kit, [x, y + post, z], height - post - .02, VANE_POST.plate);
  if (!kit.detailed) spireKnob(kit, [x, y + height - .03, z]);
};

/** War standard: wanted pole height over its foot and the plan box its pole and cloth keep clear. */
const STANDARD = { height: .8, reach: .32 } as const;

/** A palisade ring round the pole (its open middle) never blocks it. */
const ringsAround = (part: BuildingPart, foot: Point3, reach: number) => part.shape === "ring" &&
  Math.hypot(part.position[0] - foot[0], part.position[2] - foot[2]) + reach / 2 + .05 < part.size[0] / 2;

/** A tower platform raises the standard from its middle, inside the palisade: the tallest tower first. */
const towerPole = (kit: LevelKit) => {
  const towers = findRoundShafts(kit.site.parts).sort((a, b) => b.top - a.top);
  for (const { top: deck, x, z } of towers) {
    const foot: Point3 = [x, deck, z], top = poleTop(kit, foot, STANDARD.height);
    if (top === null) continue;
    const box = boxOf([x, (deck + top) / 2 + .05, z], [STANDARD.reach, top - deck - .1, STANDARD.reach]);
    const free = isFree(kit.site, box, .01, (bounds, part) => bounds.max[1] < deck + .12 ||
      ringsAround(part, foot, STANDARD.reach));
    if (free) return { axis: 0 as const, foot, top };
  }
  return null;
};

/**
 * Towers and flat roofs carry no ridge piece: a war standard in the Viking banner colours on a pole
 * with a gilded spear point, raised from a tower platform or the roof when it has room, else planted
 * in the yard, else hung from a round tower's shaft.
 */
const warStandard = (kit: LevelKit) => {
  if (isLeanPiece(kit.site, "banner")) return;
  const pole = towerPole(kit) ?? bannerPole(kit, STANDARD.height, STANDARD.reach, 1.05);
  if (!pole) {
    addShaftBanner(kit);
    return;
  }
  const { axis, foot, top } = pole, colours = BANNER_COLOURS.viking;
  addPole(kit, foot, top, .03);
  const cloth = addCloth(kit, [foot[0], top - .06, foot[2]], axis,
    { height: .24, offset: .14, tint: colours.cloth, width: .26 });
  addEmblem(kit, cloth, axis, .11, colours.emblem);
  kit.add({ position: [foot[0], top + .04, foot[2]], radialSegments: 4, shape: "cone", size: [.04, .09, .04],
    stage: 4, surface: "gold" });
};

/** The ridge turret where the ridge has room: its fit (ridge point, scale, drum width), else null. */
export const addRidgeTurret = (kit: LevelKit): TurretFit | null => {
  const crown = crownPoint(kit), ridged = Boolean(kit.site.roof) && kit.site.roof!.ridgeAxis !== null;
  const fit = crown && ridged ? findTurretFit(kit, crown) : null;
  if (fit) ridgeTurret(kit, fit);
  return fit;
};

/**
 * Level 5 Viking crown: the ridge turret. Where it has no room, civilian buildings add a lean-to
 * store; military buildings and the HQ a vane post or the war standard.
 */
export const addVikingCrown = (kit: LevelKit) => {
  if (addRidgeTurret(kit)) return;
  const crown = crownPoint(kit), ridged = Boolean(kit.site.roof) && kit.site.roof!.ridgeAxis !== null;
  if (!mayCarryFlag(kit.site.definition.id)) {
    addLeanToStore(kit);
    return;
  }
  const vane = crown && ridged ? findVaneSpot(kit, crown) : null;
  if (vane) vanePost(kit, vane);
  else warStandard(kit);
};
