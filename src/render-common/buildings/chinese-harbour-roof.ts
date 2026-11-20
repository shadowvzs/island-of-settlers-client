import { HARBOUR_TYPE_ID } from "../../shared/settlement/building-type-ids";
import type { BuildingPart, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import type { NationBody, RoofEnvelope } from "./nation-kit-classify";
import { type Add, envelopeCenter, envelopeSize } from "./nation-kit-parts";
import { ROMAN_HARBOR_BEACON_POSITION } from "./roman-harbor";

/** Beacon tower radius where it rises through the hall roof (its courses taper from 0.43). */
const TOWER_RADIUS = .41;
/** Tiled eave that clearly projects beyond the tower face instead of ending flush with it. */
const TOWER_EAVE_CLEARANCE = .12;
/** Ceramic flashing collar where the tower rises out of the hall roof (authored world heights). */
const FLASHING = { bottom: 1.2, bottomRadius: .47, top: 1.36, topRadius: .415 } as const;
/**
 * Author's outer envelope of the beacon's six stone-arc courses. The Roman courses leave a 4 mm
 * cap ledge and a 0.009 rad joint between every block; the Chinese plaster conversion turns those
 * construction joints into bright white rings and seams. The Chinese tower is one continuous
 * rammed-earth shell with the same taper (see addChineseHarbourTowerShell).
 */
const TOWER_BODY = { bottom: .002, bottomRadius: .438, top: 2.038, topRadius: .393 } as const;
const TOWER_BODY_HEIGHT = TOWER_BODY.top - TOWER_BODY.bottom;
export const CHINESE_ROOF_PURLIN_SHARE = .475;

export interface ChineseRoofFit {
  purlinShares: readonly [number, number];
  roof: RoofEnvelope;
}

/** Long-side eave purlins keep their absolute wall-line positions inside a widened envelope. */
const keptPurlinShares = (original: RoofEnvelope, fitted: RoofEnvelope): readonly [number, number] => {
  const before = envelopeSize(original), after = envelopeSize(fitted);
  const turned = after.width > after.depth;
  const axis = turned ? 2 : 0, span = turned ? after.depth : after.width;
  const oldSpan = turned ? before.depth : before.width;
  const oldCentre = envelopeCenter(original)[axis]!, centre = envelopeCenter(fitted)[axis]!;
  const share = (side: number) => {
    const purlin = oldCentre + side * CHINESE_ROOF_PURLIN_SHARE * oldSpan;
    return Math.abs(purlin - centre) / span;
  };
  // A turned roof maps its local +u side to world -z (see addChineseRoof's point()).
  return turned ? [share(1), share(-1)] : [share(-1), share(1)];
};

/**
 * The harbour's beacon tower stands in the hall's back-west roof corner. The Roman envelope ends
 * flush with the tower face, so the tower pierced the eave lip and left thin see-through slivers.
 * The hall roof is extended on those two sides only, until its eave projects past the tower.
 */
export const fitChineseHarbourHallRoof = (roof: RoofEnvelope, id: number): ChineseRoofFit | null => {
  if (id !== HARBOUR_TYPE_ID) return null;
  const [x, , z] = ROMAN_HARBOR_BEACON_POSITION;
  const inside = (axis: 0 | 2, centre: number) =>
    roof.min[axis]! < centre && roof.max[axis]! > centre;
  if (!inside(0, x) || !inside(2, z)) return null;
  const reach = TOWER_RADIUS + TOWER_EAVE_CLEARANCE;
  const fitted: RoofEnvelope = { ...roof,
    min: [Math.min(roof.min[0], x - reach), roof.min[1], Math.min(roof.min[2], z - reach)] };
  return { purlinShares: keptPurlinShares(roof, fitted), roof: fitted };
};

/**
 * A tapered tiled collar seals the tower/roof junction. Its foot lies below the extended eave on
 * the outer sides, so the shallow concave strip behind the eave lip can no longer reveal tower
 * plaster between the lip and the cover ribs; on the hall side it sinks under the higher roof.
 */
export const addChineseHarbourTowerFlashing = (add: Add, id: number, detailed: boolean,
  surface: BuildingPart["surface"]) => {
  if (id !== HARBOUR_TYPE_ID) return;
  const [x, , z] = ROMAN_HARBOR_BEACON_POSITION, height = FLASHING.top - FLASHING.bottom;
  const diameter = FLASHING.bottomRadius * 2, taper = FLASHING.topRadius / FLASHING.bottomRadius;
  add({ innerRadius: .42, position: [x, FLASHING.bottom + height / 2, z],
    radialSegments: detailed ? 24 : 12, shape: "ring", size: [diameter, height, diameter], stage: 3,
    surface, topScale: [taper, 1, taper] });
};

const towerRadiusAt = (y: number) => {
  const share = (y - TOWER_BODY.bottom) / TOWER_BODY_HEIGHT;
  const clamped = Math.min(1, Math.max(0, share));
  return TOWER_BODY.bottomRadius + (TOWER_BODY.topRadius - TOWER_BODY.bottomRadius) * clamped;
};

/** The Roman ashlar courses, which the Chinese smooth plaster shell replaces (High detail only). */
export const isChineseHarbourTowerCourse = (part: BuildingPart) => {
  if (part.stock || part.shape !== "stone-arc") return false;
  const [x, , z] = ROMAN_HARBOR_BEACON_POSITION;
  return Math.hypot(part.position[0] - x, part.position[2] - z) < .02;
};

/**
 * One continuous tapered shell over the beacon's authored envelope: no course ledges, block
 * joints or see-through slits for the plaster conversion to turn white. The existing collar bands
 * and lantern gallery sit on top of it unchanged.
 */
export const addChineseHarbourTowerShell = (add: Add, id: number, detailed: boolean,
  surface: BuildingPart["surface"], tint: Point3) => {
  if (id !== HARBOUR_TYPE_ID || !detailed) return;
  const [x, , z] = ROMAN_HARBOR_BEACON_POSITION, diameter = TOWER_BODY.bottomRadius * 2;
  // A closed cylinder gives the plaster a wrapped, smooth-shaded surface; the hollow ring's planar
  // UV fold and flat facets would leave a new texture seam exactly where the old block joint was.
  // Its one wrap seam is turned behind the shaft, under the hall roof, not into the open view.
  add({ position: [x, TOWER_BODY.bottom + TOWER_BODY_HEIGHT / 2, z], radialSegments: 32,
    rotation: [0, Math.PI, 0], shape: "cylinder", size: [diameter, TOWER_BODY_HEIGHT, diameter],
    stage: 1, surface, tint, topScale: [TOWER_BODY.topRadius / TOWER_BODY.bottomRadius, 1,
      TOWER_BODY.topRadius / TOWER_BODY.bottomRadius] });
};

/** Plan footprint gap between a part and the beacon axis (negative when the part covers it). */
const towerFootprintGap = (part: BuildingPart) => {
  const [x, , z] = ROMAN_HARBOR_BEACON_POSITION;
  const dx = x - part.position[0], dz = z - part.position[2];
  if (part.shape === "cylinder") {
    return Math.hypot(dx, dz) - Math.max(part.size[0], part.size[2]) / 2;
  }
  const yaw = part.rotation?.[1] ?? 0, cos = Math.cos(yaw), sin = Math.sin(yaw);
  const localX = dx * cos - dz * sin, localZ = dx * sin + dz * cos;
  const halfX = part.size[0] / 2, halfZ = part.size[2] / 2;
  const nearestX = Math.min(halfX, Math.max(-halfX, localX));
  const nearestZ = Math.min(halfZ, Math.max(-halfZ, localZ));
  return Math.hypot(localX - nearestX, localZ - nearestZ);
};

/** True when a part's real footprint reaches into the beacon tower's plaster body. */
export const chineseHarbourTowerIntersects = (part: BuildingPart) => {
  const bounds = getRomanPartBounds(part);
  const bottom = Math.max(TOWER_BODY.bottom, bounds.min[1]);
  if (bottom >= Math.min(TOWER_BODY.top, bounds.max[1])) return false;
  return towerFootprintGap(part) < towerRadiusAt(bottom);
};

/** Drops a wall post or its corbel bracket when the tower has replaced that wall bay. */
export const chineseHarbourTowerBlocks = (at: Point3, radius: number) => {
  const [x, , z] = ROMAN_HARBOR_BEACON_POSITION;
  if (at[1] < TOWER_BODY.bottom || at[1] > TOWER_BODY.top) return false;
  return Math.hypot(at[0] - x, at[2] - z) < towerRadiusAt(at[1]) + radius;
};

const isTowerPane = (part: BuildingPart) => {
  const [x, , z] = ROMAN_HARBOR_BEACON_POSITION;
  return !part.stock && part.surface === "dark" && part.size[1] > .15 &&
    Math.hypot(part.position[0] - x, part.position[2] - z) < TOWER_RADIUS + .05;
};

/** The tower's lowest slit window and its sill lie inside the hall attic, under the flashing. */
export const chineseHarbourBuriedTowerWindows = (body: NationBody) => {
  const panes = body.keep.filter(part => isTowerPane(part) &&
    getRomanPartBounds(part).min[1] < FLASHING.top);
  const removed = new Set<BuildingPart>(panes);
  for (const pane of panes) {
    const opening = getRomanPartBounds(pane);
    for (const part of body.keep) {
      if (part.stock || part === pane) continue;
      const bounds = getRomanPartBounds(part);
      const below = bounds.max[1] <= opening.min[1] + .01 && bounds.min[1] >= opening.min[1] - .06;
      const within = [0, 2].every(axis => bounds.min[axis]! >= opening.min[axis]! - .06 &&
        bounds.max[axis]! <= opening.max[axis]! + .06);
      if (below && within) removed.add(part);
    }
  }
  return removed;
};
