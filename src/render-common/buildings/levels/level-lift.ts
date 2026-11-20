import { advancedMaterialBaseDefinition } from "../advanced-material-buildings";
import type { BuildingDefinition } from "../building-catalog";
import type { BuildingPart, BuildingRecipe, Point3 } from "../building-recipe";
import { getRomanPartBounds } from "../building-recipe-fit";
import { classifyNationBody, type RoofEnvelope, type WallRun } from "../nation-kit-classify";
import type { BuildingLevel } from "./building-level";

/** Level from which the walls rise by one course (the raised band). */
export const RAISED_BAND_LEVEL: BuildingLevel = 3;
/**
 * Not one walled house under one roof: military and civic seats (garrison, archer and balcony
 * anchors), the mill tower, the well, mines, the harbour and the Woodcutter's own nation designs.
 * Their walls keep their height; they still get every other level addition.
 */
const FIXED_HEIGHT_IDS: ReadonlySet<number> = new Set([0, 1, 2, 4, 9, 10, 11, 12, 13, 14, 16, 17, 31, 35, 39]);
const RISE = { max: .22, min: .12, share: .16 } as const;
const STRETCH_SHAPES: ReadonlySet<BuildingPart["shape"]> = new Set(["box", "bevel-box", "cylinder"]);
/** Below the wall top: an upper wall face, not the course the roof rests on. */
const CUT_MARGIN = .01;
/** Roof overhangs and wall dressing beyond the wall faces still belong to the raised body. */
const PLAN_MARGIN = .3;

export interface BodyLift {
  cut: number;
  rise: number;
  /** Plan box of the raised body (its walls): porches, lean-tos and sheds beside it keep their height. */
  plan: { min: [number, number]; max: [number, number] };
}

const area = (roof: RoofEnvelope) => (roof.max[0] - roof.min[0]) * (roof.max[2] - roof.min[2]);

const underRoof = (wall: WallRun, roof: RoofEnvelope) => {
  const x = (wall.min[0] + wall.max[0]) / 2, z = (wall.min[2] + wall.max[2]) / 2;
  return x >= roof.min[0] - .1 && x <= roof.max[0] + .1 && z >= roof.min[2] - .1 && z <= roof.max[2] + .1;
};

/** The main walls' top (where the main roof rests) and how far a raised band lifts everything above it. */
export const findBodyLift = (definition: BuildingDefinition, recipe: BuildingRecipe): BodyLift | null => {
  if (FIXED_HEIGHT_IDS.has(advancedMaterialBaseDefinition(definition).id)) return null;
  const body = classifyNationBody(recipe);
  const roof = body.roofs.reduce<RoofEnvelope | undefined>((best, next) =>
    !best || area(next) > area(best) ? next : best, undefined);
  if (!roof) return null;
  const walls = body.walls.filter(wall => wall.base < .1 && underRoof(wall, roof));
  if (!walls.length) return null;
  const wallTop = Math.max(...walls.map(wall => wall.base + wall.height));
  const plan: BodyLift["plan"] = {
    max: [Math.max(...walls.map(wall => wall.max[0])) + PLAN_MARGIN, Math.max(...walls.map(wall => wall.max[2])) + PLAN_MARGIN],
    min: [Math.min(...walls.map(wall => wall.min[0])) - PLAN_MARGIN, Math.min(...walls.map(wall => wall.min[2])) - PLAN_MARGIN]
  };
  // A mechanism above the walls (hoist arms, sails) would part from its supports.
  if (recipe.mechanism[1] >= wallTop - CUT_MARGIN) return null;
  return { cut: wallTop - CUT_MARGIN, plan, rise: Math.min(RISE.max, Math.max(RISE.min, wallTop * RISE.share)) };
};

const isStretchable = (part: BuildingPart) => STRETCH_SHAPES.has(part.shape) && !part.topScale &&
  Math.abs(part.rotation?.[0] ?? 0) < 1e-3 && Math.abs(part.rotation?.[2] ?? 0) < 1e-3;

const raise = (point: Point3, rise: number): Point3 => [point[0], point[1] + rise, point[2]];

/**
 * Lifts the roof and everything resting above the wall top by `rise`; walls, posts and stacks
 * crossing the wall top grow by the same amount from their unchanged foot. Stock displays, the
 * door and every ground anchor stay exactly where they were.
 */
const inPlan = ({ position: [x, , z] }: BuildingPart, { plan }: BodyLift) =>
  x >= plan.min[0] && x <= plan.max[0] && z >= plan.min[1] && z <= plan.max[1];

const liftPart = (part: BuildingPart, lift: BodyLift): BuildingPart => {
  const { cut, rise } = lift;
  if (part.stock || !inPlan(part, lift)) return part;
  const { max, min } = getRomanPartBounds(part);
  if (min[1] >= cut) return { ...part, position: raise(part.position, rise) };
  if (max[1] <= cut || !isStretchable(part)) return part;
  return { ...part, position: raise(part.position, rise / 2),
    size: [part.size[0], part.size[1] + rise, part.size[2]] };
};

export const liftBuildingBody = (recipe: BuildingRecipe, lift: BodyLift): BuildingRecipe => ({
  ...recipe,
  flagAnchor: recipe.flagAnchor && recipe.flagAnchor[1] >= lift.cut ? raise(recipe.flagAnchor, lift.rise)
    : recipe.flagAnchor,
  parts: recipe.parts.map(part => liftPart(part, lift))
});
