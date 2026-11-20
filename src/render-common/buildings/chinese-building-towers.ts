import type { BuildingRecipe } from "./building-recipe";
import { addChineseBracket, addChineseRoof, CHINESE_TIMBER } from "./chinese-building-roofs";
import { militaryTowerPlans } from "./military-tower-plan";
import {
  addYaguraDoorway, addYaguraTower, addYaguraWindow, YAGURA_WATCHTOWER_LOOKOUT, type YaguraTower
} from "./military-yagura-tower";
import { type Add, doorGapOf, runBetween } from "./nation-kit-parts";
import { getOccupationRoofHeight } from "./occupation-roof-height";

/** Open fighting pavilions shade the unchanged archer decks while preserving full soldier headroom. */
export const addChineseTowerPavilions = (add: Add, original: BuildingRecipe, id: number, detailed: boolean) => {
  for (const plan of militaryTowerPlans(id, original)) {
    const tower: YaguraTower = { detailed, form: { base: Math.min(.75, plan.deck * .38), batter: .025,
      depth: plan.depth, width: plan.width,
      front: plan.kind === "watch" ? original.door[2] - .03 : undefined },
    // The watchtower's look-out windows are too small for a soldier leaning on the sill: enlarged downward.
    lookout: id === 4 ? YAGURA_WATCHTOWER_LOOKOUT : undefined, plan, x: plan.x, z: plan.z };
    const timberTower: Add = part => {
      if (part.surface === "gold") return;
      if (part.surface === "wood") return add({ ...part, surface: "paint", tint: CHINESE_TIMBER });
      if (part.surface === "plaster" || part.surface === "stone")
        return add({ ...part, surface: "plaster", tint: [.94, .91, .83] });
      add(part);
    };
    addYaguraTower(timberTower, tower);
    for (const window of plan.windows) addYaguraWindow(timberTower, tower, window);
    addYaguraDoorway(timberTower, tower, doorGapOf(original));
    const height = .92, eave = plan.deck + height;
    const halfX = plan.width / 2 - .07, halfZ = plan.depth / 2 - .07;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = plan.x + sx * halfX, z = plan.z + sz * halfZ;
      add({ position: [x, plan.deck + height / 2, z], radialSegments: detailed ? 10 : 5,
        shape: "cylinder", size: [.075, height, .075], stage: 3, surface: "paint", tint: CHINESE_TIMBER });
      addChineseBracket(add, [x, eave - .15, z], 0, detailed, .65);
    }
    for (const side of [-1, 1]) add({ position: [plan.x, eave - .025, plan.z + side * halfZ],
      shape: "box", size: [plan.width, .065, .075], stage: 3, surface: "paint", tint: CHINESE_TIMBER });
    // Edge towers already reach the plot boundary: tuck eaves over the narrower upper body.
    const overhang = plan.kind === "corner" || plan.kind === "guard" ? -.02 : .08;
    const roofWidth = plan.width + 2 * overhang, roofDepth = plan.depth + 2 * overhang;
    const width = Math.min(roofWidth, roofDepth), length = Math.max(roofWidth, roofDepth);
    const turned = roofWidth > roofDepth;
    const roofHeight = Math.max(.2, Math.min(id === 9 ? 1.1 : .85, width * .59));
    const centreY = eave + roofHeight * .44, sweep = id === 9 ? .35 : .3;
    const roofPoint = (u: number, v: number, lift = 0) => {
      const y = centreY + getOccupationRoofHeight("pyramid", u, v, sweep, .85) * roofHeight + lift;
      return (turned ? [plan.x + v * length, y, plan.z - u * width]
        : [plan.x + u * width, y, plan.z + v * length]) as [number, number, number];
    };
    // The horizontal purlin stays as the structural beam; a segmented fascia follows the upswept
    // eave above it so the roof corner does not end in an exposed gap.
    const fasciaSegments = detailed ? 4 : 2;
    for (const side of [-1, 1]) for (let segment = 0; segment < fasciaSegments; segment++) {
      const from = -.5 + segment / fasciaSegments, to = -.5 + (segment + 1) / fasciaSegments;
      runBetween(add, roofPoint(from, side * .5, -.035), roofPoint(to, side * .5, -.035),
        [.055, .06], { roofSupport: true, stage: 3, surface: "paint", tint: CHINESE_TIMBER });
    }
    addChineseRoof(add, {
      min: [plan.x - plan.width / 2 - overhang, eave, plan.z - plan.depth / 2 - overhang],
      max: [plan.x + plan.width / 2 + overhang, eave + .4, plan.z + plan.depth / 2 + overhang]
    }, 2, detailed, id === 9, "pyramid");
  }
};
