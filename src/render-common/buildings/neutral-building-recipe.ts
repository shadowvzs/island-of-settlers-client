import type { BuildingDefinition } from "./building-catalog";
import { type BuildingPart, type BuildingRecipe, createRomanBuildingRecipe, type Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { classifyNationBody, type RoofEnvelope, type WallRun } from "./nation-kit-classify";

/** These computer-owned civic/military types occur in colony and adventure expeditions. */
export const NEUTRAL_BUILDING_IDS = [0, 1, 2, 4, 9, 16] as const;
export const hasNeutralBuildingStyle = (type: number) => NEUTRAL_BUILDING_IDS.some(id => id === type);

const fieldstone = (part: BuildingPart): BuildingPart => {
  if (part.stock) return part;
  if (part.shape === "civic-column-shaft" || part.shape === "cylinder" &&
    part.surface === "stone" && part.size[0] <= .12 && part.size[1] > .5) return { ...part, shape: "cylinder", surface: "wood" };
  if (part.shape === "ring" && part.surface === "paint")
    return { ...part, surface: "wood", tint: undefined };
  if (part.surface === "mosaic") return { ...part, surface: "stone" };
  if (part.surface === "gold") return { ...part, surface: "iron" };
  if (["plaster", "cut-stone"].includes(part.surface)) return { ...part, surface: "stone" };
  if (part.militaryTower && part.surface === "stone" &&
    (part.stage >= 3 || part.position[1] > 1.8 && part.size[1] <= .3))
    return { ...part, surface: "wood" };
  return part;
};

/** Board infill and independently supported frames keep every original wall opening intact. */
const addFramedWall = (parts: BuildingPart[], wall: WallRun, detailed: boolean) => {
  const center = wall.min.map((value, axis) => (value + wall.max[axis]!) / 2) as Point3;
  const size = wall.min.map((value, axis) => wall.max[axis]! - value) as Point3;
  parts.push({ position: center, shape: "box", size, stage: 1, surface: "planks", worldUv: 1 });
  const along = wall.along, across = along === 0 ? 2 : 0;
  if (wall.height < .5 || wall.length < .32) return;
  for (const side of [-1, 1]) {
    const position = [...center] as Point3, postSize: Point3 = [.065, wall.height, .065];
    position[along] += side * (wall.length / 2 - .04);
    postSize[across] = Math.min(size[across]!, .1);
    parts.push({ position, shape: "box", size: postSize, stage: 1, surface: "wood" });
  }
  const railSize = [...size] as Point3;
  railSize[1] = .065;
  for (const y of [wall.min[1] + .035, wall.max[1] - .035])
    parts.push({ position: [center[0], y, center[2]], shape: "box", size: railSize,
      stage: 2, surface: "wood" });
  if (!detailed) return;
  // Pegs are recessed into the load-bearing post rather than floating in front of the wall.
  for (const side of [-1, 1]) for (const y of [wall.min[1] + .13, wall.max[1] - .13]) {
    const position = [...center] as Point3;
    position[along] += side * (wall.length / 2 - .04);
    position[1] = y;
    const peg: Point3 = [.018, .025, .018];
    peg[across] = size[across]! + .004;
    parts.push({ position, shape: "box", size: peg, stage: 2, surface: "iron" });
  }
};

/** Original envelopes constrain new silhouettes; defensive decks remain uncovered for archers. */
const addRoof = (parts: BuildingPart[], roof: RoofEnvelope, id: number) => {
  const size = roof.min.map((value, axis) => roof.max[axis]! - value) as Point3;
  const position = roof.min.map((value, axis) => (value + roof.max[axis]!) / 2) as Point3;
  parts.push({ occupationRoof: id === 1 ? "barrel" : "half-hip", position,
    shape: "occupation-roof", size, stage: 4, surface: "roof-shingles", worldUv: 1 });
  // The visible eave beam carries the roof around the entire original wall envelope.
  parts.push({ position: [position[0], roof.min[1] + .025, position[2]], shape: "box",
    size: [size[0] * .94, .05, size[2] * .94], stage: 3, surface: "wood" });
};

const addDefensiveStakes = (parts: BuildingPart[], original: BuildingRecipe, detailed: boolean) => {
  const crowns = original.parts.filter(part => part.militaryTower && part.stage >= 3 &&
    part.surface === "stone" && part.shape === "box" && part.size[1] <= .3);
  for (const crown of crowns) {
    const bounds = getRomanPartBounds(crown);
    const along = crown.size[0] >= crown.size[2] ? 0 : 2;
    const length = crown.size[along]!;
    if (length < .07) continue;
    const count = detailed ? Math.max(1, Math.floor(length / .14)) : 1;
    for (let index = 0; index < count; index++) {
      const position = [...crown.position] as Point3;
      position[along] += ((index + .5) / count - .5) * length;
      position[1] = bounds.max[1] + .035;
      const size: Point3 = [.06, .07, .06];
      size[along] = length / count * .7;
      parts.push({ position, shape: "gable", size, stage: 3, surface: "wood",
        rotation: crown.rotation ?? (along === 2 ? [0, Math.PI / 2, 0] : undefined) });
    }
  }
};

/** A separate enemy kit: fieldstone, framed board halls, curved roofs and timber stake crowns. */
export const createNeutralBuildingRecipe = (definition: BuildingDefinition, detailed = true): BuildingRecipe => {
  const original = createRomanBuildingRecipe(definition, detailed, false);
  if (!hasNeutralBuildingStyle(definition.id)) return original;
  const body = classifyNationBody(original);
  // The civic statue and its pedestal do not belong above the new watch-hall roof.
  const kept = body.keep.filter(part => definition.id !== 0 || part.stock ||
    !(part.stage === 4 && part.shape === "bevel-box" && part.position[1] > 3));
  const parts = [...kept, ...body.doorSurround].map(fieldstone);
  for (const wall of body.walls) {
    if (definition.id === 9 || definition.id === 4) {
      // Existing tower gate/window slabs stay masonry: their apertures are garrison contracts.
      parts.push({ position: wall.min.map((v, axis) => (v + wall.max[axis]!) / 2) as Point3,
        shape: "box", size: wall.min.map((v, axis) => wall.max[axis]! - v) as Point3,
        stage: 1, surface: "stone", worldUv: 1 });
    } else addFramedWall(parts, wall, detailed);
  }
  for (const roof of body.roofs) addRoof(parts, roof, definition.id);
  addDefensiveStakes(parts, original, detailed);
  return { ...original, hideFlag: true, parts };
};
