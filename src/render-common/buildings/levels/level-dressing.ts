import type { WorkerNation } from "../../workers/worker-unit";
import type { BuildingPart, BuildingSurface, Point3 } from "../building-recipe";
import { JAPANESE_OPEN_WORKSHOPS } from "../japanese-workshop-windows";
import type { WallRun } from "../nation-kit-classify";
import { seatStorageDoorJamb } from "../storage-door-profile";
import {
  alongWallBox, boxOf, groundWalls, isFree, type LevelKit, spansClearOfDoor, wallCorners, wallFace
} from "./level-kit";
import { isLeanPiece } from "./level-lean";
import type { RoundShaft } from "./level-site";

interface Material { surface: BuildingSurface; tint?: Point3; shape?: BuildingPart["shape"] }
type Framing = "pilasters" | "wall-plate" | "tie-beam" | "buttresses";

/** Each nation's own reading of the shared Lv2/Lv3 kit (materials and the framing it builds). */
interface DressingStyle {
  plinth: Material & { height: number; out: number };
  band: Material & { height: number; out: number };
  framing: Framing;
  frame: Material;
  shutter: Material | null;
}

const STYLES: Readonly<Record<WorkerNation, DressingStyle>> = {
  maya: {
    band: { height: .065, out: .025, surface: "cut-stone", shape: "bevel-box" },
    frame: { surface: "wood" }, framing: "wall-plate",
    plinth: { height: .15, out: .03, surface: "cut-stone" }, shutter: { surface: "straw" }
  },
  persian: {
    band: { height: .07, out: .025, surface: "plaster", shape: "bevel-box" },
    frame: { surface: "plaster" }, framing: "buttresses",
    plinth: { height: .14, out: .03, surface: "cut-stone", tint: [.8, .76, .66] },
    shutter: { surface: "wood", tint: [.53, .4, .27] }
  },
  chinese: {
    band: { height: .065, out: .025, surface: "paint", tint: [.46, .16, .1] },
    frame: { surface: "paint", tint: [.46, .16, .1] }, framing: "tie-beam",
    plinth: { height: .12, out: .03, surface: "cut-stone", tint: [.7, .69, .62] },
    shutter: { surface: "wood", tint: [.65, .53, .38] }
  },
  indigenous: {
    band: { height: .055, out: .025, surface: "rope" }, frame: { surface: "wood" }, framing: "wall-plate",
    plinth: { height: .12, out: .025, surface: "plaster", tint: [.49, .39, .25] }, shutter: { surface: "hide" }
  },
  japanese: {
    band: { height: .055, out: .03, surface: "wood" }, frame: { surface: "wood" }, framing: "tie-beam",
    plinth: { height: .1, out: .04, surface: "cut-stone", tint: [.72, .72, .74] },
    shutter: { surface: "straw", tint: [.86, .76, .5] }
  },
  nubian: {
    band: { height: .07, out: .025, surface: "paint", tint: [.74, .5, .26] },
    frame: { surface: "plaster" }, framing: "buttresses",
    plinth: { height: .2, out: .03, surface: "paint", tint: [.56, .3, .18] },
    shutter: { surface: "paint", tint: [.2, .42, .62] }
  },
  roman: {
    band: { height: .06, out: .03, surface: "cut-stone", shape: "bevel-box" },
    frame: { surface: "cut-stone" }, framing: "pilasters",
    plinth: { height: .15, out: .035, surface: "stone", tint: [.62, .6, .56] },
    shutter: { surface: "wood", tint: [.42, .58, .46] }
  },
  viking: {
    band: { height: .07, out: .035, surface: "wood", shape: "bevel-box" },
    frame: { surface: "wood", shape: "bevel-box" }, framing: "wall-plate",
    plinth: { height: .16, out: .05, surface: "stone", shape: "bevel-box" },
    shutter: { surface: "wood", tint: [.7, .6, .48] }
  }
};

const styleOf = (kit: LevelKit) => STYLES[kit.site.nation];

const material = ({ shape, surface, tint }: Material) => ({ shape: shape ?? "box" as const, surface, tint });

/** Round segments of the rings dressing a round tower on High and Minimal. */
const RING_SEGMENTS = { high: 16, minimal: 10 } as const;

/** A low ring (plinth course or string course) round a round tower body, `out` proud of its face. */
const addShaftRing = (kit: LevelKit, shaft: RoundShaft, ring: Material & { out: number }, bottom: number,
  height: number, stage: number) => {
  const diameter = (shaft.radius + ring.out) * 2;
  kit.add({ ...material(ring), position: [shaft.x, bottom + height / 2, shaft.z], shape: "cylinder",
    radialSegments: kit.detailed ? RING_SEGMENTS.high : RING_SEGMENTS.minimal, size: [diameter, height, diameter], stage });
};

/** Nothing but the tower itself (and what lies inside its face) stands in the ring's way. */
const isRingFree = (kit: LevelKit, shaft: RoundShaft, out: number, bottom: number, height: number) => {
  const reach = shaft.radius + out + .02;
  return isFree(kit.site, boxOf([shaft.x, bottom + height / 2, shaft.z], [reach * 2, height, reach * 2]), .01,
    bounds => Math.max(Math.hypot(bounds.min[0] - shaft.x, bounds.min[2] - shaft.z),
      Math.hypot(bounds.max[0] - shaft.x, bounds.max[2] - shaft.z)) <= shaft.radius * Math.SQRT2 + .01 &&
      Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]) <= shaft.radius * 2 + .02);
};

/** A stone (or whitewashed) foot round every ground wall, open at the doorway, and round each round tower. */
const addPlinth = (kit: LevelKit) => {
  const { plinth } = styleOf(kit);
  for (const shaft of kit.site.roundShafts) addShaftRing(kit, shaft, plinth, 0, plinth.height, 1);
  for (const wall of groundWalls(kit.site)) for (const span of spansClearOfDoor(kit.site, wall, .09)) {
    const box = alongWallBox(kit.site, wall, span, { bottom: 0, depth: plinth.out + .03, extend: plinth.out,
      height: plinth.height, out: plinth.out });
    kit.add({ ...material(plinth), ...box, stage: 1 });
  }
};

const wallTop = (wall: WallRun) => wall.base + wall.height;

/** Corner strips (Roman pilasters, Nubian battered buttresses) at every real corner. */
const addCornerStrips = (kit: LevelKit, framing: Framing) => {
  const { frame } = styleOf(kit);
  for (const { end, wall } of wallCorners(kit.site)) {
    const { axis, face, sign } = wallFace(kit.site, wall), tip = end ? wall.max[wall.along]! : wall.min[wall.along]!;
    const width = framing === "pilasters" ? .13 : .16, out = framing === "pilasters" ? .025 : .06;
    const height = framing === "pilasters" ? wall.height : Math.min(wall.height * .7, .8);
    let position: Point3 = [0, wall.base + height / 2, 0];
    const size: Point3 = [0, height, 0];
    position[wall.along] = tip - (end ? 1 : -1) * (width / 2 - out);
    size[wall.along] = width;
    position[axis] = face + sign * out / 2;
    size[axis] = out + .02;
    if (kit.site.recipe.doubleDoor) position = seatStorageDoorJamb(position, size, kit.site.door);
    kit.add({ ...material(frame), position, size, stage: 2,
      topScale: framing === "buttresses" ? [.55, 1, .55] : undefined });
  }
};

/** A timber beam laid along every wall: Viking wall plates under the eave, Japanese nageshi above the door. */
const addBeams = (kit: LevelKit, framing: Framing) => {
  const { frame } = styleOf(kit), { door } = kit.site;
  for (const wall of groundWalls(kit.site)) {
    const bottom = framing === "wall-plate" ? wallTop(wall) - .11 : door.top + .15;
    if (bottom + .07 > wallTop(wall) || bottom < door.top + .13) continue;
    const box = alongWallBox(kit.site, wall, [0, 1], { bottom, depth: .06, extend: .03, height: .07, out: .035 });
    kit.add({ ...material(frame), ...box, stage: 2 });
  }
};

/** High only: Minimal keeps the plinth and sign as the level 2 reading. */
const addFraming = (kit: LevelKit) => {
  if (!kit.detailed) return;
  const { framing } = styleOf(kit);
  if (framing === "pilasters" || framing === "buttresses") addCornerStrips(kit, framing);
  else addBeams(kit, framing);
};

/** Window panes set in an outer wall face (thin dark boxes at window height). */
const windowPanes = (kit: LevelKit) => kit.site.parts.map(part => part.windowOpeningPosition ? {
  ...part, position: part.windowOpeningPosition, size: part.windowOpeningSize ?? part.size, shape: "box" as const
} : part).filter(part => part.surface === "dark" && part.shape === "box" &&
  !part.stock && !part.rotation && Math.min(part.size[0], part.size[2]) <= .05 && Math.max(part.size[0], part.size[2]) >= .14 &&
  part.size[1] >= .14 && part.size[1] <= .5 && part.position[1] > .3);

/** High: opened shutter leaves beside each window (Japanese: a rolled bamboo blind over its head). */
const addShutters = (kit: LevelKit) => {
  const { shutter } = styleOf(kit);
  if (!shutter || !kit.detailed) return;
  for (const pane of windowPanes(kit)) {
    const along = pane.size[0] >= pane.size[2] ? 0 : 2, across = along === 0 ? 2 : 0;
    const outward = Math.sign(pane.position[across]! - kit.site.centre[across]!) || 1;
    const width = pane.size[along]!, height = pane.size[1];
    if (kit.site.nation === "japanese") {
      const position: Point3 = [...pane.position];
      const openWorkshop = JAPANESE_OPEN_WORKSHOPS.includes(kit.site.definition.id) || kit.site.definition.id === 0;
      position[1] += openWorkshop ? height / 2 + .035 : height * .28;
      position[across] += outward * .035;
      const size: Point3 = [0, openWorkshop ? .05 : height * .46, 0];
      size[along] = width + .04; size[across] = .02;
      kit.add({ ...material(shutter), position, size });
      continue;
    }
    for (const side of [-1, 1]) {
      const position: Point3 = [...pane.position], size: Point3 = [0, height + .03, 0];
      position[along] += side * (width * .75 + .03);
      position[across] += outward * .025;
      size[along] = width / 2 + .01; size[across] = .022;
      if (!isFree(kit.site, boxOf(position, size), .005, bounds => (bounds.max[across]! - bounds.min[across]!) > .15))
        continue;
      kit.add({ ...material(shutter), position, shape: "bevel-box", size });
    }
  }
};

/** Level 2 "dressed": plinth, framing and shutters. */
export const addDressedLevel = (kit: LevelKit) => {
  addPlinth(kit);
  addFraming(kit);
  addShutters(kit);
};

/** Level 3: a string course round the walls where they were raised (or at two thirds without a raise). */
export const addRaisedBand = (kit: LevelKit) => {
  if (isLeanPiece(kit.site, "band")) return;
  const { band } = styleOf(kit), lift = kit.site.lift;
  for (const shaft of kit.site.roundShafts) {
    const course = [.72, .58, .86].map(share => shaft.top * share)
      .find(bottom => bottom > kit.site.door.top + .1 && isRingFree(kit, shaft, band.out, bottom, band.height));
    if (course !== undefined) addShaftRing(kit, shaft, band, course, band.height, 2);
  }
  for (const wall of groundWalls(kit.site)) {
    // Over the door head even where two thirds of the wall would cut across it.
    const course = lift ? lift.cut + band.height / 2 : Math.max(wall.base + wall.height * .72, kit.site.door.top + .1);
    if (course + band.height > wallTop(wall) || course < kit.site.door.top + .1) continue;
    const box = alongWallBox(kit.site, wall, [0, 1], { bottom: course - band.height / 2, depth: band.out + .03,
      extend: band.out, height: band.height, out: band.out });
    kit.add({ ...material(band), ...box, stage: 2 });
  }
};
