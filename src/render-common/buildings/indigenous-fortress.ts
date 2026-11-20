import type { BuildingPart, BuildingRecipe } from "./building-recipe";
import { addIndigenousFortressDeck } from "./indigenous-fortress-decks";
import { addIndigenousFramedBody } from "./indigenous-framed-body";
import { addIndigenousLodge } from "./indigenous-lodges";
import { fortressTowerPlans } from "./military-tower-plan";
import type { NationBody } from "./nation-kit-classify";
import type { Add } from "./nation-kit-parts";

/** One substantial textile garrison joins four covered towers and a higher command landing. */
export const addIndigenousFortress = (add: Add, original: BuildingRecipe, body: NationBody,
  detailed: boolean) => {
  const plans = fortressTowerPlans(), rocks: BuildingPart[] = [];
  // Foundation obstacles exist before any skirt anchors are chosen, so no peg enters a boulder.
  for (const plan of plans.filter(plan => plan.kind === "corner")) for (const side of [-1, 1]) rocks.push({
    position: [plan.x + side * .235, .025, plan.z + side * .29], shape: "rock",
    rotation: [.10, side * .12, .06], size: [.23, .23 + (side > 0 ? .03 : 0), .30],
    stage: 0, surface: "stone", tint: [.67, .69, .70] });
  for (const rock of rocks) add(rock);
  const hall: NationBody = { ...body, roofs: [{ min: [-1.19, 0, -.88], max: [1.19, 1.6, .87] }] };
  addIndigenousLodge(add, original, hall, true, detailed, 1.60, 1.60, rocks);
  for (const plan of plans) {
    const corner = plan.kind === "corner";
    const width = plan.width - (corner ? .07 : .04), depth = plan.depth - (corner ? .07 : .04);
    addIndigenousFramedBody(add, original, [plan.x, 0, plan.z],
      [width, plan.deck - .025, depth], detailed, [0, 0, -.5], false,
      { frameMargin: .12, radius: .20, obstacles: rocks });
    addIndigenousFortressDeck(add, plan, detailed);
  }
};
