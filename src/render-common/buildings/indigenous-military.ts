import { WORKER_HEIGHT } from "../workers/worker-dimensions";
import { getBuildingDefinition } from "./building-catalog";
import type { BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanRecipeBounds } from "./building-recipe-fit";
import { getRomanBuildingWorldSizing } from "./building-world-sizing";
import { addIndigenousFramedBody } from "./indigenous-framed-body";
import { indigenousRoofHeight } from "./indigenous-roof-profile";
import { militaryTowerPlans, type TowerPlan } from "./military-tower-plan";
import { type Add, runBetween } from "./nation-kit-parts";

const pole = (add: Add, from: Point3, to: Point3, thickness = .04, rope = false) =>
  runBetween(add, from, to, [thickness, thickness], { stage: 2, surface: rope ? "rope" : "wood" });

/** Irregular plank landings are carried by braced splayed posts, with room for both feet. */
const addLookout = (add: Add, plan: TowerPlan, detailed: boolean, roofless: boolean, curtain: boolean) => {
  const triangular = plan.kind === "corner";
  const overhang = plan.kind === "corner" ? .94 : 1.07;
  const width = plan.width * overhang, depth = plan.depth * overhang;
  const corners = triangular ? [[-.26, -.43], [.43, -.43], [.43, .43], [-.43, .43]] :
    [[-.43, -.4], [.41, -.43], [.43, .43], [-.42, .41]];
  const floor = Math.max(.02, plan.base), wrapped = plan.kind !== "corner";
  if (wrapped) {
    if (plan.kind === "guard") {
      const localDoor: BuildingRecipe = { doorProfile: "flat", door: [plan.x - .10, 0, plan.z + plan.depth * .475],
        doorDimensions: { height: .67, spring: .6, width: .20 }, parts: [], mechanism: [0, 0, 0],
        workPoint: [plan.x, 0, plan.z + 1], workerExit: [plan.x, 0, plan.z + 1] };
      addIndigenousFramedBody(add, localDoor, [plan.x, 0, plan.z],
        [plan.width * .90, plan.deck - .05, plan.depth * .95], detailed);
    }
  }
  if (!wrapped) for (const [sx, sz] of corners) {
    const from: Point3 = [plan.x + sx! * plan.width, floor, plan.z + sz! * plan.depth];
    const to: Point3 = [plan.x + sx! * plan.width * .82, plan.deck + .09, plan.z + sz! * plan.depth * .82];
    pole(add, from, to, .08);
    add({ position: [to[0], plan.deck - .04, to[2]], radialSegments: detailed ? 7 : 4,
      shape: "ring", size: [.085, .045, .085], stage: 3, surface: "rope" });
  }
  const rows = detailed ? 9 : 5;
  for (let index = 0; index < rows; index++) {
    const z = -depth / 2 + depth * (index + .5) / rows;
    const left = triangular ? -width / 2 + Math.max(0, -z / depth) * width * .45 :
      -width / 2 + Math.abs(z / depth) * width * .04;
    const right = width / 2 - (triangular ? 0 : Math.abs(z / depth) * width * .06);
    add({ position: [plan.x + (left + right) / 2, plan.deck - .025, plan.z + z], shape: "box",
      size: [right - left, .05, depth / rows * .95], stage: 2, surface: "planks" });
  }
  // Triangular brackets and a second brace carry the complete deck instead of balancing planks
  // on thin poles; the shortened rear corner keeps its own light silhouette.
  if (!wrapped) {
    const deckCorners = corners.map(([sx, sz]): Point3 =>
      [plan.x + sx! * plan.width * .82, plan.deck - .07, plan.z + sz! * plan.depth * .82]);
    for (let index = 0; index < deckCorners.length; index++)
      pole(add, deckCorners[index]!, deckCorners[(index + 1) % deckCorners.length]!, .045);
    pole(add, [plan.x - plan.width * .26, .08, plan.z - plan.depth * .43],
      [plan.x + plan.width * .35, plan.deck - .08, plan.z - plan.depth * .35], .04);
  }
  // The low open guard preserves every canonical archer position and aiming clearance.
  if (!wrapped) pole(add, [plan.x + plan.width * .43, .08, plan.z - plan.depth * .43],
    [plan.x + plan.width * .36, plan.deck - .08, plan.z + plan.depth * .36], .035);
  for (const side of [-1, 1]) pole(add,
    [plan.x + side * plan.width * .4, plan.deck - .025, plan.z + plan.depth * .42],
    [plan.x + side * plan.width * .4, plan.deck + .32, plan.z + plan.depth * .42], .035);
  pole(add, [plan.x - plan.width * .4, plan.deck + .26, plan.z + plan.depth * .42],
    [plan.x + plan.width * .4, plan.deck + .26, plan.z + plan.depth * .42], curtain ? .014 : .035, curtain);
  if (curtain) add({ position: [plan.x + plan.width * .04, plan.deck + .15, plan.z + plan.depth * .41],
    shape: "box", size: [plan.width * .58, .21, .012], stage: 3, surface: "cloth" });
  const ladderZ = plan.z - plan.depth * (wrapped ? .58 : .18);
  const ladderX = plan.x + (triangular ? plan.width * .34 : 0);
  for (const side of [-1, 1]) pole(add, [ladderX + side * .09, .04, ladderZ],
    [ladderX + side * .09, plan.deck, ladderZ], .025);
  const rungs = detailed ? Math.ceil(plan.deck / .18) : Math.ceil(plan.deck / .3);
  for (let rung = 1; rung < rungs; rung++) pole(add,
    [ladderX - .1, plan.deck * rung / rungs, ladderZ], [ladderX + .1, plan.deck * rung / rungs, ladderZ], .02);
  if (wrapped) for (const side of [-1, 1]) pole(add,
    [ladderX + side * .09, plan.deck - .015, ladderZ],
    [ladderX + side * .09, plan.deck - .015, plan.z - depth / 2 + .02], .02);
  if (roofless || plan.kind === "corner" || plan.kind === "guard") return;
  const eave = plan.deck + .82, rise = .28;
  add({ indigenousRoof: "awning", position: [plan.x, eave + rise / 2, plan.z], shape: "indigenous-roof",
    size: [plan.width + .08, rise, plan.depth + .08], stage: 3, surface: "cloth" });
  for (const side of [-1, 1]) {
    const offsetX = side < 0 && triangular ? plan.width * .28 : 0;
    const offsetZ = side * plan.depth * .27;
    const head = eave + rise / 2 + rise * indigenousRoofHeight("awning",
      offsetX / (plan.width + .08), offsetZ / (plan.depth + .08)) - .045;
    pole(add, [plan.x + offsetX, plan.deck, plan.z + offsetZ],
      [plan.x + offsetX, head, plan.z + offsetZ], .035);
    if (offsetX) pole(add, [plan.x + offsetX, head, plan.z + offsetZ],
      [plan.x, eave + .22, plan.z + offsetZ], .025);
  }
  pole(add, [plan.x, eave + .22, plan.z - plan.depth * .28],
    [plan.x, eave + .22, plan.z + plan.depth * .28], .03);
};

/** A grounded camp perimeter is about one-and-a-half people high, with a broad open service gate. */
const addCampPerimeter = (add: Add, original: BuildingRecipe, id: number, detailed: boolean) => {
  const definition = getBuildingDefinition(id), sizing = getRomanBuildingWorldSizing(definition);
  const height = 1.5 * WORKER_HEIGHT / sizing.scale, bounds = getRomanRecipeBounds(definition, original);
  const xReach = bounds.extentX - .065, zReach = bounds.extentZ - .065;
  const centre = original.door[0] + (original.doorDimensions?.width ?? .46) / 2;
  const segments = [
    [[-xReach, 0, -zReach], [-xReach, 0, zReach]],
    [[xReach, 0, -zReach], [xReach, 0, zReach]],
    [[-xReach, 0, -zReach], [xReach, 0, -zReach]],
    [[-xReach, 0, zReach], [centre - .65, 0, zReach]],
    [[centre + .65, 0, zReach], [xReach, 0, zReach]]
  ] as const;
  for (const [from, to] of segments) {
    const length = Math.hypot(to[0] - from[0], to[2] - from[2]);
    if (length < .08) continue;
    const count = Math.max(1, Math.ceil(length / (detailed ? .22 : .33)));
    for (let index = 0; index <= count; index++) {
      const share = index / count, x = from[0] + (to[0] - from[0]) * share;
      const z = from[2] + (to[2] - from[2]) * share, tall = height * (.94 + index % 3 * .04);
      add({ position: [x, tall / 2, z], radialSegments: detailed ? 7 : 4,
        shape: "cylinder", size: [.045, tall, .045], stage: 1, surface: "wood" });
      add({ position: [x, tall + .035, z], radialSegments: detailed ? 7 : 4,
        shape: "cone", size: [.045, .07, .045], stage: 2, surface: "wood" });
    }
    for (const y of [height * .32, height * .72])
      pole(add, [from[0], y, from[2]], [to[0], y, to[2]], .035);
    pole(add, [from[0], .04, from[2]], [to[0], height * .85, to[2]], .03);
  }
};

/** Occupied compounds have low rounded earth banks and woven reed screens, rather than log walls. */
const addMilitaryCourt = (add: Add, original: BuildingRecipe, id: number, detailed: boolean) => {
  const bounds = getRomanRecipeBounds(getBuildingDefinition(id), original);
  const reach = bounds.extentX - .16, rear = -bounds.extentZ + .18;
  for (const side of [-1, 1]) {
    // Flattened bank is half buried; its broad foot is firmly grounded.
    add({ position: [side * reach * .75, -.04, rear + .25], shape: "sphere",
      size: [reach * .46, .40, .73], stage: 1, surface: "plaster", tint: [.48, .35, .22] });
    const x = side * reach * .78, z = rear + .27;
    for (const dx of [-.17, .17]) pole(add, [x + dx, .015, z], [x + dx, .88, z], .035);
    const strands = detailed ? 9 : 5;
    for (let index = 0; index < strands; index++) pole(add,
      [x - .19, .19 + index * .065, z], [x + .19, .19 + index * .065, z], .025, true);
    add({ position: [x, .77, z], shape: "box", size: [.34, .11, .014], stage: 3, surface: "cloth" });
  }
};

/** Open pole lookouts preserve the exact fighting deck coordinates without inherited window panels. */
export const addIndigenousMilitary = (add: Add, original: BuildingRecipe, id: number, detailed: boolean) => {
  if (id === 9) return; // Its unified covered structure and fighting decks are authored together.
  const roofless = id === 4 || id === 9;
  for (const plan of militaryTowerPlans(id, original)) addLookout(add, plan, detailed, roofless, id !== 4);
  if (roofless) addCampPerimeter(add, original, id, detailed);
  if ([2, 9, 40].includes(id)) addMilitaryCourt(add, original, id, detailed);
};
