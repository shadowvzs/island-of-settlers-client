import type { BuildingDefinition } from "./building-catalog";
import type { Point3 } from "./building-recipe";
import type { RoofEnvelope, WallRun } from "./nation-kit-classify";
import {
  alongWall, envelopeCenter, envelopeSize, type KitContext, onWall, wallNormal
} from "./nation-kit-parts";

const DOMED_BUILDINGS = new Set([0, 6, 13, 14, 23, 29, 34, 40, 58, 59, 62]);
const TERRACE_BUILDINGS = new Set([1, 2, 4, 9]);
const SHADED_BUILDINGS = new Set([17, 18, 19, 20, 22, 33, 36, 39]);
const LIMESTONE: Point3 = [.86, .79, .66];
const RELIEF: Point3 = [.97, .9, .76];

/** The roof family is tied to the occupation, not a random cosmetic roof colour. */
export const persianRoofFamily = (definition: BuildingDefinition) => {
  if (DOMED_BUILDINGS.has(definition.id)) return "domed";
  if (TERRACE_BUILDINGS.has(definition.id)) return "terrace";
  if (SHADED_BUILDINGS.has(definition.id)) return "vaulted-shelter";
  return "vaulted";
};

/** Thick lime-plastered walls, shallow engaged piers, and continuous stone splash courses. */
export const addPersianWall = (context: KitContext, wall: WallRun) => {
  const { add, center, detailed } = context, normal = wallNormal(wall, center);
  const thickness = normal.thickness + .035;
  add({ position: onWall(wall, center, .5, wall.base + wall.height / 2, -.0175), shape: "box",
    size: alongWall(wall, wall.length, wall.height, thickness), stage: 1, surface: "plaster" });
  if (wall.height < .45 || wall.length < .3) return;
  const foot = Math.min(.12, wall.height * .18);
  add({ position: onWall(wall, center, .5, wall.base + foot / 2, -.008), shape: "bevel-box",
    size: alongWall(wall, wall.length, foot, thickness + .015), stage: 1, surface: "cut-stone", tint: LIMESTONE });
  const piers = detailed ? Math.max(2, Math.ceil(wall.length / .7) + 1) : 2;
  for (let index = 0; index < piers; index++) {
    const t = .07 + .86 * index / Math.max(1, piers - 1), tall = wall.height - foot;
    add({ position: onWall(wall, center, t, wall.base + foot + tall / 2, normal.thickness / 2 - .016),
      shape: "bevel-box", size: alongWall(wall, .065, tall, .045), stage: 2, surface: "plaster" });
  }
  if (!detailed) return;
  add({ position: onWall(wall, center, .5, wall.base + wall.height - .08, normal.thickness / 2 - .012),
    shape: "box", size: alongWall(wall, wall.length - .06, .055, .035), stage: 2,
    surface: "paint", tint: RELIEF });
};

const addCornice = (context: KitContext, roof: RoofEnvelope) => {
  const { add } = context, { depth, width } = envelopeSize(roof), centre = envelopeCenter(roof);
  const inset = .035;
  for (const side of [-1, 1]) {
    add({ position: [centre[0], centre[1] + .045, centre[2] + side * (depth / 2 - inset)],
      shape: "box", size: [width - .025, .09, .065], stage: 3, surface: "plaster" });
    add({ position: [centre[0] + side * (width / 2 - inset), centre[1] + .045, centre[2]],
      shape: "box", size: [.065, .09, depth - .025], stage: 3, surface: "plaster" });
  }
};

const addVault = (context: KitContext, roof: RoofEnvelope, shelter: boolean) => {
  const { add, detailed } = context, { depth, width, height } = envelopeSize(roof);
  const [x, base, z] = envelopeCenter(roof), turned = width > depth;
  const across = turned ? depth : width, length = turned ? width : depth;
  const rise = Math.min(Math.max(.25, height * .95), across * .57);
  const rotation: Point3 | undefined = turned ? [0, Math.PI / 2, 0] : undefined;
  add({ occupationRoof: "barrel", position: [x, base + rise * .44, z], rotation, radialSegments: detailed ? 16 : 6, shape: "occupation-roof",
    size: [across, rise, length], stage: 3, surface: "roof" });
  // The infill closes the ends beneath the curved roof; it is part of the vault rather than a timber gable.
  add({ occupationRoof: "barrel", position: [x, base + rise * .44, z], rotation, shape: "roof-infill",
    size: [Math.max(.05, across - .04), rise, Math.max(.05, length - .04)], stage: 3, surface: "plaster" });
  if (!detailed) return;
  const ribs = shelter ? 3 : Math.max(3, Math.floor(length / .5));
  for (let index = 0; index < ribs; index++) {
    const along = -length * .46 + length * .92 * index / Math.max(1, ribs - 1);
    const position: Point3 = turned ? [x + along, base + rise * .44, z] : [x, base + rise * .44, z + along];
    add({ occupationRoof: "barrel", position, rotation, radialSegments: detailed ? 16 : 6, shape: "occupation-roof",
      size: [across - .006, rise + .018, .035], stage: 3, surface: "paint", tint: RELIEF });
  }
};

const addTerrace = (context: KitContext, roof: RoofEnvelope, dome: boolean) => {
  const { add, detailed } = context, { depth, width, height } = envelopeSize(roof);
  const centre = envelopeCenter(roof), [x, y, z] = centre;
  add({ roofSupport: true, position: [x, y + .015, z], shape: "box", size: [width, .06, depth], stage: 3, surface: "plaster" });
  addCornice(context, roof);
  if (!dome) return;
  const diameter = Math.min(width, depth) * .76;
  const drumHeight = Math.min(.16, diameter * .16);
  const domeHeight = Math.min(Math.max(.36, height * 1.25), diameter * .78);
  add({ position: [x, y + .045 + drumHeight / 2, z], radialSegments: detailed ? 24 : 10,
    shape: "cylinder", size: [diameter * .92, drumHeight, diameter * .92], stage: 3, surface: "plaster" });
  add({ position: [x, y + .045 + drumHeight, z], shape: "dome", size: [diameter, domeHeight, diameter],
    stage: 3, surface: "roof" });
  if (!detailed || diameter < .6) return;
  add({ position: [x, y + .047 + drumHeight, z], shape: "ring", size: [diameter * .96, .035, diameter * .96],
    radialSegments: 24, stage: 3, surface: "paint", tint: RELIEF });
};

/** Civic roofs carry domes; industry uses vaults and shelters; garrisons keep usable open terraces. */
export const addPersianRoof = (context: KitContext, roof: RoofEnvelope, definition: BuildingDefinition,
  main: boolean, supportsCupola = false) => {
  if (supportsCupola) { addTerrace(context, roof, false); return; }
  const family = persianRoofFamily(definition);
  if (family === "domed" && (main || roof.round)) { addTerrace(context, roof, true); return; }
  if (family === "terrace") { addTerrace(context, roof, false); return; }
  if (roof.round) { addTerrace(context, roof, true); return; }
  addVault(context, roof, family === "vaulted-shelter");
};

/** A substantial square chamber replaces the classical open colonnade beneath a raised dome. */
export const addPersianCupolaDrum = (context: KitContext, roof: RoofEnvelope, deck: RoofEnvelope) => {
  const { add, detailed } = context, [x, top, z] = envelopeCenter(roof);
  const base = deck.min[1] + .07, height = top - base, { depth, width } = envelopeSize(roof);
  const span = Math.min(width, depth) * .68;
  if (height <= .1) return;
  add({ position: [x, base + height / 2, z], shape: "bevel-box", size: [span, height, span],
    stage: 2, surface: "plaster" });
  add({ position: [x, top - .03, z], shape: "box", size: [span + .1, .1, span + .1],
    stage: 3, surface: "paint", tint: RELIEF });
  if (!detailed) return;
  for (const side of [-1, 1]) for (const axis of [0, 2] as const) {
    const at: Point3 = [x, base + height * .57, z];
    at[axis] += side * (span / 2 + .007);
    add({ position: at, shape: "window-shadow", size: axis === 0 ? [.025, height * .44, .15] : [.15, height * .44, .025],
      stage: 3, surface: "dark" });
  }
};

/** The shared leaf sits in a recessed, thick plaster entrance with a taller shallow iwan frame. */
export const addPersianEntrance = (context: KitContext) => {
  const { add, detailed, door } = context, width = door.right - door.left;
  const x = (door.right + door.left) / 2;
  for (const side of [-1, 1]) {
    add({ position: [x + side * (width / 2 + .09), (door.top + .16) / 2, door.z - .035],
      shape: "bevel-box", size: [.13, door.top + .16, .17], stage: 2, surface: "plaster" });
    if (detailed) add({ position: [x + side * (width / 2 + .09), door.top + .17, door.z - .035],
      shape: "bevel-box", size: [.17, .075, .19], stage: 2, surface: "paint", tint: RELIEF });
  }
  add({ position: [x, door.top + .21, door.z - .035], shape: "bevel-box",
    size: [width + .33, .1, .18], stage: 2, surface: "plaster" });
  if (!detailed) return;
  add({ position: [x, door.top + .275, door.z - .025], shape: "box",
    size: [width + .37, .035, .17], stage: 3, surface: "paint", tint: RELIEF });
};
