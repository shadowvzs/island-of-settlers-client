import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";

/** One straight wall run of the Roman body, rebuilt in each nation's own construction. */
export interface WallRun { min: Point3; max: Point3; along: 0 | 2; length: number; height: number; base: number }
export interface RoofEnvelope {
  min: Point3; max: Point3; rotated?: boolean;
  /** A lone dome or cone: a round cupola or lantern roof rather than a rectangular roof. */
  round?: boolean;
  /** Authored roof rise (nation designs); kit roofs otherwise derive it from the span. */
  rise?: number;
}
export interface NationBody {
  /** Props, stock, mechanisms and trims that every nation keeps (some re-surfaced later). */
  keep: BuildingPart[];
  walls: WallRun[];
  roofs: RoofEnvelope[];
  /** Arch fillers and arch rings around the shared arched door leaf. */
  doorSurround: BuildingPart[];
}

const WALL_SURFACES = new Set(["stone", "plaster", "cut-stone"]);
const MAX_POST_WIDTH = .05;
const REMOVED_SHAPES = new Set(["civic-statue", "stone-block", "tile", "gable"]);

/** Upright masonry slabs; slender posts (window jambs) are trims, not walls to rebuild. */
const isWall = (part: BuildingPart) => part.shape === "box" && WALL_SURFACES.has(part.surface) && part.stage <= 2 &&
  !part.stock && part.size[1] > .3 && Math.min(part.size[0], part.size[2]) < .2 &&
  Math.max(part.size[0], part.size[2]) > MAX_POST_WIDTH && !part.rotation;

const isRoofPanel = (part: BuildingPart) => part.surface === "roof" &&
  (["civic-hipped-roof", "dome", "cone"].includes(part.shape) || part.shape === "box" && part.size[1] < .1);

/** Upright drums and rings carry cupolas and lantern roofs: structure, not roofing. */
const isDrum = (part: BuildingPart) => (part.shape === "cylinder" && !part.rotation && part.size[1] >= part.size[0] * .5) ||
  part.shape === "ring";

const isRoofPiece = (part: BuildingPart) =>
  (part.surface.startsWith("roof") && !isDrum(part)) || part.shape === "civic-hipped-roof";

const wallRun = (part: BuildingPart): WallRun => {
  const { max, min } = getRomanPartBounds(part);
  const along = part.size[0] >= part.size[2] ? 0 : 2;
  return { along, base: min[1], height: max[1] - min[1], length: max[along] - min[along], max, min };
};

const combine = (parts: readonly BuildingPart[]): RoofEnvelope => {
  const min: Point3 = [Infinity, Infinity, Infinity], max: Point3 = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const bounds = getRomanPartBounds(part);
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis]!, bounds.min[axis]!);
      max[axis] = Math.max(max[axis]!, bounds.max[axis]!);
    }
  }
  return { max, min };
};

/** Pairs mirrored roof panels into one envelope; a lone panel or dome is its own envelope. */
const roofEnvelopes = (parts: readonly BuildingPart[]) => {
  const panels = parts.filter(isRoofPanel);
  const unpaired = new Set(panels), roofs: RoofEnvelope[] = [];
  for (const panel of panels) {
    if (!unpaired.delete(panel)) continue;
    const paired = panels.filter(other => unpaired.has(other) && panel.shape === "box" && other.shape === "box" &&
      Math.abs(panel.rotation?.[2] ?? 0) > .1 &&
      Math.abs(panel.position[1] - other.position[1]) < .002 &&
      Math.abs(panel.size[0] - other.size[0]) < .002 && Math.abs(panel.size[2] - other.size[2]) < .002 &&
      Math.abs((panel.rotation?.[2] ?? 0) + (other.rotation?.[2] ?? 0)) < .002 &&
      DMath.hypot(panel.position[0] - other.position[0], panel.position[2] - other.position[2]) < panel.size[0] * 1.1)
      .sort((a, b) => DMath.hypot(a.position[0] - panel.position[0], a.position[2] - panel.position[2]) -
        DMath.hypot(b.position[0] - panel.position[0], b.position[2] - panel.position[2]))[0];
    if (paired) unpaired.delete(paired);
    const envelope = combine(paired ? [panel, paired] : [panel]);
    envelope.rotated = Boolean(paired && Math.abs(panel.position[2] - paired.position[2]) >
      Math.abs(panel.position[0] - paired.position[0]));
    envelope.round = !paired && (panel.shape === "dome" || panel.shape === "cone");
    roofs.push(envelope);
  }
  return roofs;
};

/** Splits a Roman recipe into the architecture a nation replaces and everything it keeps. */
export const classifyNationBody = (recipe: BuildingRecipe): NationBody => {
  const body: NationBody = { doorSurround: [], keep: [], roofs: roofEnvelopes(recipe.parts), walls: [] };
  for (const part of recipe.parts) {
    if (part.stock) body.keep.push(part);
    else if (REMOVED_SHAPES.has(part.shape) || isRoofPiece(part)) continue;
    else if (part.shape === "arch-spandrel" || part.shape === "stone-arc") body.doorSurround.push(part);
    else if (isWall(part)) body.walls.push(wallRun(part));
    else body.keep.push(part.surface.startsWith("roof") ? { ...part, surface: "plaster" } : part);
  }
  return body;
};
