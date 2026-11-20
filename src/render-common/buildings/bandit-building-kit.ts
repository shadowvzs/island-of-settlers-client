import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { militaryTowerPlans, type TowerPlan } from "./military-tower-plan";
import { type Add,runBetween } from "./nation-kit-parts";
import type { EnemyBuildingDesign } from "./themed-neutral-building-style";

/** Independent outlaw architecture. Only the entrance, stock and combat anchors come from the legacy plan. */
const STRONGHOLD_REFUGE_FOOTPRINT = [1.8, 1.36] as const;
const ENCAMPMENT_REFUGE_FOOTPRINT = [1.1, 0.92] as const;
const HIDEOUT_REFUGE_FOOTPRINT = [1.58, 1.18] as const;

/** Refuge width and depth by camp type (9 stronghold, 4 encampment, otherwise hideout). */
const getRefugeFootprint = (typeId: number) => {
  if (typeId === 9) return STRONGHOLD_REFUGE_FOOTPRINT;
  return typeId === 4 ? ENCAMPMENT_REFUGE_FOOTPRINT : HIDEOUT_REFUGE_FOOTPRINT;
};

export const createBanditMilitaryRecipe = (
  definition: BuildingDefinition,
  original: BuildingRecipe,
  design: EnemyBuildingDesign,
  detailed: boolean,
  variation: 0 | 1 | 2 = 0
): BuildingRecipe => {
  const parts = original.parts.filter((part) => part.stock);
  const add: Add = (part) => parts.push({ stage: 2, ...part });
  const box = (position: Point3, size: Point3, surface: BuildingPart["surface"], stage = 2) =>
    add({ position, size, surface, shape: detailed ? "bevel-box" : "box", stage });
  const doorWidth = original.doorDimensions?.width ?? 0.46;
  const centre = original.door[0] + doorWidth / 2;
  const front = original.door[2] - 0.035;
  const [width, depth] = getRefugeFootprint(definition.id);
  const height = definition.id === 4 ? 1.12 : 1.25;
  const z = front - depth / 2;
  const wall = 0.085;
  const opening = Math.max(0.9, original.doorDimensions?.height ?? 0.77);
  // A low asymmetric refuge under separate lookout scaffolds, rather than a national stone keep.
  box([centre, 0.045, z], [width, 0.09, depth], "stone", 0);
  box([centre, height / 2, front - depth], [width, height, wall], design.walls, 1);
  for (const sign of [-1, 1]) {
    box(
      [centre + sign * (width / 2 - wall / 2), height / 2, z],
      [wall, height, depth],
      design.walls,
      1
    );
    const wing = (width - doorWidth - 0.08) / 2;
    box(
      [centre + sign * (doorWidth / 2 + 0.04 + wing / 2), height / 2, front],
      [wing, height, wall],
      design.walls,
      1
    );
    box(
      [centre + sign * (doorWidth / 2 + 0.055), opening / 2, front + 0.005],
      [0.07, opening, 0.1],
      "wood",
      1
    );
  }
  box(
    [centre, (height + opening) / 2, front],
    [doorWidth + 0.08, height - opening, wall],
    design.walls,
    1
  );
  box([centre, opening + 0.015, front + 0.005], [doorWidth + 0.18, 0.08, 0.11], "wood");
  add({
    position: [centre, height + 0.24, z],
    size: [width + 0.12, 0.48, depth + 0.12],
    shape: "occupation-roof",
    occupationRoof: variation === 1 ? "gable" : design.profile,
    surface: design.roof,
    worldUv: 1,
    stage: 4
  });
  if (design.snow)
    add({
      position: [centre, height + 0.263, z],
      size: [width + 0.115, 0.48, depth + 0.115],
      shape: "occupation-roof",
      occupationRoof: variation === 1 ? "gable" : design.profile,
      surface: "plaster",
      tint: [0.93, 0.95, 0.97],
      stage: 4
    });
  const profile = variation === 1 ? "gable" : design.profile;
  for (const side of [-1, 1])
    add({
      position: [centre, height + 0.24, z + side * (depth / 2 - 0.035)],
      size: [width, 0.48, 0.07],
      shape: "roof-infill",
      occupationRoof: profile,
      roofInfillRatio: [width / (width + 0.12), (depth - 0.07) / (depth + 0.12)],
      surface: design.walls,
      stage: 3
    });
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = centre + sx * (width / 2 - 0.055),
        back = z + sz * (depth / 2 - 0.04);
      add({
        position: [x, height / 2, back],
        size: [0.095, height, 0.095],
        shape: "cylinder",
        radialSegments: detailed ? 7 : 3,
        surface: "bark",
        stage: 1
      });
    }
  // Shuttered side openings vary by model; they never borrow a nation's window arrangement.
  if (variation !== 2)
    for (const side of variation === 0 ? [-1] : [-1, 1]) {
      const x = centre + side * (width / 2 + 0.002);
      box([x, 0.73, z], [0.012, 0.25, 0.24], "dark");
      for (const end of [-1, 1])
        box([x + side * 0.02, 0.73, z + end * 0.15], [0.04, 0.31, 0.055], "wood");
      box([x + side * 0.02, 0.57, z], [0.08, 0.045, 0.36], "wood");
    }
  for (const [index, plan] of militaryTowerPlans(definition.id, original).entries())
    addLookout(add, plan, design, detailed, variation, index);
  // Patch panels, lashings and salvage read as construction rather than national insignia.
  const panelZ = front - depth + 0.055;
  box([centre + width * 0.23, 0.63, panelZ], [width * 0.32, 0.46, 0.025], "cloth");
  if (detailed)
    for (const offset of [-0.12, 0, 0.12])
      box([centre + width * 0.23 + offset, 0.63, panelZ + 0.018], [0.012, 0.44, 0.012], "rope");
  if (design.nautical) {
    const wheelZ = front - depth - 0.065;
    add({
      position: [centre, 0.72, wheelZ],
      size: [0.32, 0.035, 0.32],
      shape: "ring",
      rotation: [Math.PI / 2, 0, 0],
      surface: "wood",
      stage: 3,
      radialSegments: detailed ? 16 : 4,
      innerRadius: 0.7
    });
    const spokes = detailed ? 6 : 4;
    for (let spoke = 0; spoke < spokes; spoke++) {
      const angle = (spoke * Math.PI * 2) / spokes;
      runBetween(
        add,
        [centre, 0.72, wheelZ],
        [centre + DMath.cos(angle) * 0.19, 0.72 + DMath.sin(angle) * 0.19, wheelZ],
        [0.02, 0.025],
        { shape: "box", surface: "wood", stage: 3 }
      );
    }
    add({
      position: [centre, 0.72, wheelZ],
      size: [0.07, 0.07, 0.05],
      shape: "cylinder",
      rotation: [Math.PI / 2, 0, 0],
      radialSegments: detailed ? 10 : 6,
      surface: "iron",
      stage: 3
    });
  }
  return { ...original, hideFlag: true, parts };
};

const addLookout = (
  add: Add,
  plan: TowerPlan,
  design: EnemyBuildingDesign,
  detailed: boolean,
  variation: number,
  index: number
) => {
  const halfX = plan.width * (plan.kind === "guard" ? 0.4 : 0.43),
    halfZ = plan.depth * 0.43;
  const floor = plan.deck - 0.045;
  const elevated = plan.kind === "corner" || plan.kind === "guard";
  const enclosed = variation !== 2 && (!elevated || (variation === 1 && index === 0));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = plan.x + sx * halfX,
        z = plan.z + sz * halfZ;
      add({
        position: [x, floor / 2, z],
        size: [0.085, floor, 0.085],
        shape: "cylinder",
        radialSegments: detailed ? 7 : 3,
        surface: "bark",
        stage: 1
      });
      add({
        position: [x, 0.05, z],
        size: [0.105, 0.1, 0.105],
        shape: "rock",
        surface: "stone",
        stage: 0
      });
      if (detailed || design.lashings)
        add({
          position: [x, floor - 0.18, z],
          size: [0.105, 0.055, 0.105],
          shape: "cylinder",
          radialSegments: detailed ? 7 : 3,
          surface: "rope"
        });
    }
  // Broad platform supports the inherited archer posts, with irregular slatted breastworks.
  add({
    position: [plan.x, floor, plan.z],
    size: [plan.width * 0.98, 0.09, plan.depth * 0.98],
    shape: "box",
    surface: "planks",
    stage: 3,
    militaryTower: true
  });
  for (const side of [-1, 1]) {
    runBetween(
      add,
      [plan.x - halfX, 0.22, plan.z + side * halfZ],
      [plan.x + halfX, floor - 0.1, plan.z + side * halfZ],
      [0.045, 0.055],
      { shape: "bevel-box", surface: "wood", stage: 2 }
    );
    if (enclosed)
      add({
        position: [plan.x + side * halfX, floor * 0.61, plan.z],
        size: [0.065, floor * 0.55, plan.depth * 0.82],
        shape: "box",
        surface: design.walls,
        stage: 1
      });
    // Low irregular rails leave standing figures fully exposed above the deck.
    add({
      position: [plan.x + side * halfX, plan.deck + 0.12, plan.z],
      size: [0.055, 0.24 + (index % 2) * 0.04, plan.depth * 0.9],
      shape: "box",
      surface: "wood",
      stage: 3
    });
    add({
      position: [plan.x, plan.deck + 0.1, plan.z + side * halfZ],
      size: [plan.width * 0.9, 0.2, 0.055],
      shape: "box",
      surface: "wood",
      stage: 3
    });
  }
  // Back ladders make each scaffold reachable and stay out of the civilian entrance.
  const ladderX = plan.x - halfX * 0.65,
    ladderZ = plan.z - halfZ;
  for (const side of [-1, 1])
    add({
      position: [ladderX + side * 0.075, floor / 2, ladderZ],
      size: [0.025, floor, 0.035],
      shape: "box",
      surface: "wood",
      stage: 2
    });
  const rungs = Math.ceil(floor / (detailed ? 0.19 : 0.55));
  for (let rung = 1; rung < rungs; rung++)
    add({
      position: [ladderX, (floor * rung) / rungs, ladderZ],
      size: [0.18, 0.025, 0.035],
      shape: "box",
      surface: "wood",
      stage: 2
    });
};
