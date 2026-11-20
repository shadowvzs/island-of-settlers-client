import type { BuildingPart, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import type { RoofEnvelope } from "./nation-kit-classify";

type Bounds = ReturnType<typeof getRomanPartBounds>;

/** Occupation tablet authored by addRomanOccupationPainting. */
export const TABLET_SIZE: Point3 = [.31, .18, .045];
/** The flat roof's parapet: its outer face sits this far inside the roof envelope, its centre this far up. */
const PARAPET_FACE_INSET = .06;
const PARAPET_CENTER = .12;
const CONTACT = .012;
/** Loose props whose foot hovers below this height are set down on the ground instead of removed. */
const GROUND_PROP_HEIGHT = .3;
const PLANTED_DEPTH = .015;

export const isTablet = (part: BuildingPart) => part.shape === "box" && !part.stock && part.surface === "stone" &&
  part.size.every((value, axis) => Math.abs(value - TABLET_SIZE[axis]!) < .005);

export const onTablet = (part: BuildingPart, tablet: BuildingPart) => part.surface === "paint" &&
  Math.abs(part.position[0] - tablet.position[0]) < TABLET_SIZE[0] / 2 + .01 &&
  Math.abs(part.position[1] - tablet.position[1]) < TABLET_SIZE[1] / 2 + .01 &&
  part.position[2] > tablet.position[2] - .01 && part.position[2] < tablet.position[2] + .05;

/** The flat roof whose front edge the tablet was mounted under, on the old Roman gable. */
const gableRoof = (tablet: BuildingPart, roofs: readonly RoofEnvelope[]) => roofs
  .filter(roof => !roof.round && tablet.position[0] > roof.min[0] && tablet.position[0] < roof.max[0] &&
    Math.abs(tablet.position[2] - roof.max[2]) < .25 &&
    tablet.position[1] > roof.min[1] - .1 && tablet.position[1] < roof.max[1] + .3)
  .sort((a, b) => Math.abs(tablet.position[2] - a.max[2]) - Math.abs(tablet.position[2] - b.max[2]))[0];

const moved = (part: BuildingPart, offset: Point3): BuildingPart => ({ ...part,
  position: [part.position[0] + offset[0], part.position[1] + offset[1], part.position[2] + offset[2]] });

/**
 * The occupation tablet hung on the Roman gable, which the flat terrace replaces: tablet and pictogram
 * move together onto the front parapet. Returns each moved original part with its new placement.
 */
export const remountNubianSigns = (keep: readonly BuildingPart[], roofs: readonly RoofEnvelope[]) => {
  const placements = new Map<BuildingPart, BuildingPart>();
  for (const tablet of keep.filter(isTablet)) {
    const roof = gableRoof(tablet, roofs);
    if (!roof) continue;
    const offset: Point3 = [0, roof.min[1] + PARAPET_CENTER - tablet.position[1],
      roof.max[2] - PARAPET_FACE_INSET + TABLET_SIZE[2] / 2 + .001 - tablet.position[2]];
    for (const part of keep) if (part === tablet || onTablet(part, tablet)) placements.set(part, moved(part, offset));
  }
  return placements;
};

const touches = (a: Bounds, b: Bounds) => [0, 1, 2].every(axis =>
  a.min[axis]! - CONTACT <= b.max[axis]! && b.min[axis]! - CONTACT <= a.max[axis]!);

/** Indices reachable from the ground through touching parts (the same rule as the Roman support test). */
const groundedParts = (bounds: readonly Bounds[]) => {
  const grounded = new Set<number>(), pending: number[] = [];
  bounds.forEach((box, index) => { if (box.min[1] <= .001) { grounded.add(index); pending.push(index); } });
  while (pending.length) {
    const source = bounds[pending.pop()!]!;
    bounds.forEach((box, index) => {
      if (grounded.has(index) || !touches(source, box)) return;
      grounded.add(index); pending.push(index);
    });
  }
  return grounded;
};

/** Loose parts gathered into the assemblies that touch each other. */
const looseAssemblies = (bounds: readonly Bounds[], loose: readonly number[]) => {
  const unassigned = new Set(loose), assemblies: number[][] = [];
  for (const start of loose) {
    if (!unassigned.delete(start)) continue;
    const assembly = [start];
    for (let cursor = 0; cursor < assembly.length; cursor++) for (const other of Array.from(unassigned)) {
      if (!touches(bounds[assembly[cursor]!]!, bounds[other]!)) continue;
      unassigned.delete(other); assembly.push(other);
    }
    assemblies.push(assembly);
  }
  return assemblies;
};

/**
 * Roman details that hung on replaced gables or eaves lose their support on a flat terrace: a low
 * prop is set down on the ground, anything higher is left out. Stock displays are never touched.
 */
export const settleNubianParts = (parts: readonly BuildingPart[]) => {
  const bounds = parts.map(part => getRomanPartBounds(part)), grounded = groundedParts(bounds);
  const loose = parts.flatMap((_part, index) => grounded.has(index) ? [] : [index]);
  if (!loose.length) return [...parts];
  const result = [...parts] as Array<BuildingPart | null>;
  for (const assembly of looseAssemblies(bounds, loose)) {
    if (assembly.some(index => parts[index]!.stock)) continue;
    const foot = Math.min(...assembly.map(index => bounds[index]!.min[1]));
    for (const index of assembly)
      result[index] = foot < GROUND_PROP_HEIGHT ? moved(parts[index]!, [0, -foot - PLANTED_DEPTH, 0]) : null;
  }
  return result.filter((part): part is BuildingPart => part !== null);
};
