import type { RoadDecorationDefinition, RoadDecorationStoneFamily } from "../shared/settlement/road-decoration-catalog";
import type { BuildingPart, BuildingSurface, Point3 } from "./buildings/building-recipe";
import type { ClimberFoliageTileId } from "./plants/climber-foliage-atlas-layout";

type PartTint = NonNullable<BuildingPart["tint"]>;

export interface RoadArchStone {
  rubble?: number;
  /** Recessed binding between visible blocks; no bevel may cut through the narrow joint. */
  mortar?: boolean;
  kind: "arch-stone";
  position: Point3;
  innerRadius: number;
  thickness: number;
  depth: number;
  from: number;
  to: number;
  surface: BuildingSurface;
  tint: NonNullable<BuildingPart["tint"]>;
}
export interface RoadProfilePart {
  kind: "swept-beam" | "lantern-roof" | "folded-leaf" | "botanical-leaf" | "wisteria-raceme" |
    "rubble-stone" | "roman-column";
  columnOrder?: 0 | 1;
  seed?: number;
  profileSegments?: number;
  position: Point3;
  size: Point3;
  sweep?: number;
  rotation?: Point3;
  surface: BuildingSurface;
  tint: NonNullable<BuildingPart["tint"]>;
}
/** One trimmed climber-atlas card (D04a outline): its pivot sits on the supporting stem. */
export interface RoadFoliageCard {
  /** Backward bend of the far edge (world units), so leaves arch instead of standing flat. */
  curl?: number;
  /** Approximate front normal; orthogonalised against `up`. */
  facing: Point3;
  kind: "foliage-card";
  /** Attachment point (petiole, pedicel or stem base) of the tile. */
  position: Point3;
  /** World size of one tile edge. */
  size: number;
  surface: "foliage";
  tile: ClimberFoliageTileId;
  tint: PartTint;
  /** Growth direction of the tile's +v axis. */
  up: Point3;
}
/** High rose bloom: three whorls of cupped petal patches on atlas petals, calyx card behind. */
export interface RoadRoseHead {
  /** Flower axis, pointing out of the open bloom. */
  axis: Point3;
  kind: "rose-head";
  /** Receptacle at the tip of the pedicel. */
  position: Point3;
  /** Reach of the outer whorl. */
  radius: number;
  seed: number;
  surface: "foliage";
  tint: PartTint;
}
/** Smooth tapered tube along a polyline: canes, shoots, petioles, ivy stems and rootlets. */
export interface RoadClimberStem {
  kind: "climber-stem";
  points: Point3[];
  /** Radius at the first and the last point. */
  radius: readonly [number, number];
  sides: number;
  /** Woody stems borrow the frame's wood map (one merged draw with the frame). */
  surface: "wood";
  tint: PartTint;
}
export type RoadFoliagePart = RoadFoliageCard | RoadRoseHead;
export type RoadDecorationPart = BuildingPart | RoadArchStone | RoadProfilePart | RoadFoliagePart | RoadClimberStem;
export interface RoadDecorationRecipe {
  definition: RoadDecorationDefinition;
  parts: RoadDecorationPart[];
  /** Static parts have no animation owner or wind attributes. */
  wind: 0;
  stoneFamily?: RoadDecorationStoneFamily;
}
export type AddRoadPart = (part: Omit<BuildingPart, "stage">) => void;

export const roadDecorationAdder = (parts: RoadDecorationPart[]): AddRoadPart =>
  part => parts.push({ stage: 4, compactGeometry: true, ...part });

/** Profile members join physically; the individual solid recipe retains the shared material mapping. */
export const roadProfileBeam = (add: AddRoadPart, from: Point3, to: Point3,
  thickness: number, depth: number, surface: BuildingSurface, tint?: BuildingPart["tint"], bevel = true) => {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  add({ shape: bevel ? "bevel-box" : "box", position: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, from[2]],
    rotation: [0, 0, Math.atan2(dy, dx)], size: [Math.hypot(dx, dy) + .006, thickness, depth], surface, tint });
};
