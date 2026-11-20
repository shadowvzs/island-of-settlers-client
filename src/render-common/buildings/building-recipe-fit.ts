import { DMath } from "../../shared/math/deterministic-math";
import { MILL_TYPE_ID } from "../../shared/settlement/building-type-ids";
import { WORKER_HEIGHT, WORKER_RADIUS } from "../workers/worker-dimensions";
import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { MONUMENT_TYPE_ID } from "./monument-definition";
import { type EulerTurn, eulerTurn, turnPoint } from "./recipe-rotation";
import { DEFAULT_ROMAN_DOOR } from "./roman-door-profile";
import { romanFurnaceAnchors } from "./roman-furnaces";
import { ROMAN_MILL_ROTOR_HALF_DEPTH,ROMAN_MILL_ROTOR_RADIUS } from "./roman-mill-dimensions";

const NO_ROTATION: Point3 = [0, 0, 0];

/** Engine-neutral rotated recipe-box corner, matching Three's Euler ZYX transform (`turn`: the part's rotation). */
const transformedCorner = (part: BuildingPart, turn: EulerTurn, x: number, y: number, z: number): Point3 => {
  if (part.shape === "civic-hipped-roof" && y < 0) y *= 1.26;
  if (part.shape === "dome") { y = Math.max(0, y); x *= 1.012; z *= 1.012; }
  const fraction = y / part.size[1] + 0.5;
  x = x * (1 + ((part.topScale?.[0] ?? 1) - 1) * fraction) + (part.topOffset?.[0] ?? 0) * fraction;
  z = z * (1 + ((part.topScale?.[2] ?? 1) - 1) * fraction) + (part.topOffset?.[2] ?? 0) * fraction;
  const [turnedX, turnedY, turnedZ] = turnPoint(x, y, z, turn);
  return [part.position[0] + turnedX, part.position[1] + turnedY, part.position[2] + turnedZ];
};

/**
 * Horizontal bounds of a part at one height (recipe units): a tapered tower is narrower at its
 * windows than its base AABB says, and that local face is what hides a leaning soldier.
 */
export const getRomanPartSliceBounds = (part: BuildingPart, y: number, yaw = 0) => {
  const min: Point3 = [Infinity, Infinity, Infinity], max: Point3 = [-Infinity, -Infinity, -Infinity];
  const sy = Math.max(-0.5, Math.min(0.5, (y - part.position[1]) / part.size[1]));
  const turn = eulerTurn(part.rotation ?? NO_ROTATION), cosYaw = DMath.cos(yaw), sinYaw = DMath.sin(yaw);
  for (const sx of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
    const corner = transformedCorner(part, turn, sx * part.size[0], sy * part.size[1], sz * part.size[2]);
    const point: Point3 = [corner[0] * cosYaw + corner[2] * sinYaw, corner[1], -corner[0] * sinYaw + corner[2] * cosYaw];
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis]!, point[axis]!); max[axis] = Math.max(max[axis]!, point[axis]!);
    }
  }
  return { min, max };
};

/** Exact transformed recipe-box bounds; shaped meshes remain inside their authored boxes. */
export const getRomanPartBounds = (part: BuildingPart, yaw = 0) => {
  const min: Point3 = [Infinity, Infinity, Infinity], max: Point3 = [-Infinity, -Infinity, -Infinity];
  const turn = eulerTurn(part.rotation ?? NO_ROTATION), cosYaw = DMath.cos(yaw), sinYaw = DMath.sin(yaw);
  for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
    const corner = transformedCorner(part, turn, sx * part.size[0], sy * part.size[1], sz * part.size[2]);
    const point: Point3 = [corner[0] * cosYaw + corner[2] * sinYaw, corner[1], -corner[0] * sinYaw + corner[2] * cosYaw];
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis]!, point[axis]!); max[axis] = Math.max(max[axis]!, point[axis]!);
    }
  }
  return { min, max };
};

/** Mechanism envelopes are authored gameplay data, including the full moving sail/arm sweep. */
const mechanismEnvelope = (definition: BuildingDefinition): [number, number] => {
  if (definition.id === MILL_TYPE_ID) return [ROMAN_MILL_ROTOR_RADIUS, ROMAN_MILL_ROTOR_HALF_DEPTH];
  if (definition.id === 35) return [0.29, 0.78];
  if ([36, 39].includes(definition.id)) return [0.58, 0.58];
  if (definition.id === 25) return [0.30, 0.07];
  if (definition.id === 26) return [0.19, 0.36];
  if (definition.id === 32 || definition.mechanism === "none") return [0, 0];
  if (definition.mechanism === "crane") return [0.58, 0.16];
  if (definition.mechanism === "wheel") return [0.24, 0.08];
  if (definition.mechanism === "hammer") return [0.19, 0.09];
  return [0.10, 0.10];
};

export const getRomanRecipeBounds = (definition: BuildingDefinition, recipe: BuildingRecipe, includeEffects = true) => {
  let extentX = 0, extentZ = 0;
  const include = ([x, , z]: Point3) => {
    extentX = Math.max(extentX, Math.abs(x));
    extentZ = Math.max(extentZ, Math.abs(z));
  };
  for (const part of recipe.parts) {
    const turn = eulerTurn(part.rotation ?? NO_ROTATION);
    for (const sx of [-0.5, 0.5])
      for (const sy of [-0.5, 0.5])
        for (const sz of [-0.5, 0.5])
          include(transformedCorner(part, turn, sx * part.size[0], sy * part.size[1], sz * part.size[2]));
  }
  const [mechanismX, mechanismZ] = mechanismEnvelope(definition);
  if (mechanismX || mechanismZ)
    for (const side of [-1, 1])
      include([recipe.mechanism[0] + side * mechanismX, 0, recipe.mechanism[2] + side * mechanismZ]);
  if (recipe.flagAnchor)
    for (const side of [-1, 1])
      include([recipe.flagAnchor[0] + side * 0.47, 0, recipe.flagAnchor[2] + side * 0.47]);
  const furnace = romanFurnaceAnchors(definition, recipe);
  if (furnace && includeEffects) {
    // Conservative full 3D puff sweep: drift, expansion and irregular sphere lobes.
    include([furnace.smoke[0] - 0.33, 0, furnace.smoke[2] - 0.32]);
    include([furnace.smoke[0] + 0.61, 0, furnace.smoke[2] + 0.32]);
  }
  if (definition.style !== "well" && definition.id !== MONUMENT_TYPE_ID) {
    const width = (recipe.doorDimensions ?? DEFAULT_ROMAN_DOOR).width;
    include([recipe.door[0] - 0.04, 0, recipe.door[2] - 0.04]);
    include([recipe.door[0] + width + 0.04, 0, recipe.door[2] + width + 0.04]);
  }
  if (recipe.balconyDoor) {
    const { position, width } = recipe.balconyDoor;
    for (const side of [-1, 1]) include([position[0] + side * width, 0, position[2] + side * width]);
  }
  return { extentX, extentZ, width: extentX * 2, depth: extentZ * 2 };
};

/** Uniform scale preserves the authored architecture; plot rounding never changes its proportions. */
export const getRomanRecipeFitScale = (definition: BuildingDefinition, recipe: BuildingRecipe) => {
  if (definition.id === MONUMENT_TYPE_ID) return 1;
  if (definition.style === "well") {
    const bounds = getRomanRecipeBounds(definition, recipe);
    return Math.min(1, 0.94 / bounds.width, 1.94 / bounds.depth);
  }
  const dimensions = recipe.doorDimensions ?? DEFAULT_ROMAN_DOOR;
  const headroom = recipe.doorProfile === "arched" ? dimensions.spring : dimensions.height;
  return Math.max((WORKER_HEIGHT + 0.0575) / headroom, (2 * WORKER_RADIUS + 0.04) / dimensions.width);
};
