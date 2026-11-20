import type { Point3 } from "./building-recipe";
import {
  addMerlonCrown,
  addRoundTowerBody,
  addRoundTowerSlits,
  addRoundTowerWindow,
  type RoundTower,
  type RoundTowerStyle,
  towerSegments} from "./military-round-tower";
import {
  AUTHORED_GROUND,
  FORTRESS_CORNER,
  FORTRESS_KEEP,
  fortressTowerPlans,
  GUARD_TOWER,
  type TowerPlan,
  WATCHTOWER,
  WATCHTOWER_SILL} from "./military-tower-plan";
import type { Add } from "./nation-kit-parts";
import {
  type RomanDesignContext,
  romanLadder,
  romanRoom,
  romanWallOpening} from "./roman-design-kit";

export interface RomanMilitaryAnchors {
  flagAnchor?: Point3;
  archerPositions?: Point3[];
  balconyDoor?: { position: Point3; width: number; height: number; yaw: number };
}
/** A stone tower with an open crenellated deck; `width` runs along x, `depth` along z. */
const towerDeck = (
  context: RomanDesignContext,
  x: number,
  z: number,
  height: number,
  width: number,
  depth = width
) => {
  const { detailed, part } = context;
  // A hatch and an interior ladder make the rooftop physically reachable.
  for (const side of [-1, 1]) {
    const wallX = x + side * (width / 2 - 0.05);
    if (side === -Math.sign(x)) {
      for (const end of [-1, 1])
        part(
          "stone",
          [wallX, (height + 0.18) / 2, z + end * depth * 0.36],
          [0.1, height - 0.18, depth * 0.28],
          1
        );
      part("stone", [wallX, (height + 0.96) / 2, z], [0.1, height - 0.96, depth * 0.44], 1);
    } else part("stone", [wallX, (height + 0.18) / 2, z], [0.1, height - 0.18, depth], 1);
    part(
      "stone",
      [x, (height + 0.18) / 2, z + side * (depth / 2 - 0.05)],
      [width - 0.2, height - 0.18, 0.1],
      1
    );
    part("stone", [x + side * width * 0.36, height, z], [width * 0.28, 0.08, depth], 2);
  }
  part("stone", [x, height, z + depth * 0.27], [width * 0.44, 0.08, depth * 0.46], 2);
  part("stone", [x, height, z - depth * 0.35], [width * 0.44, 0.08, depth * 0.3], 2);
  // The interior ladder is hidden from outside; Minimal leaves it out to stay within budget.
  if (detailed) romanLadder(part, x, z - depth * 0.08, height + 0.08, 0.18, 0.15);
  for (const side of [-1, 1])
    for (const end of [-1, 1])
      part(
        "stone",
        [x + side * width * 0.38, height + 0.18, z + end * depth * 0.38],
        [width * 0.23, 0.28, depth * 0.23],
        3
      );
  if (detailed)
    for (const side of [-1, 1]) {
      part("dark", [x + (side * width) / 2, height * 0.58, z], [0.012, 0.3, 0.045], 2);
      part("stone", [x + (side * width) / 2, height * 0.58 - 0.17, z], [0.06, 0.04, 0.1], 2);
    }
};
/** Every part the build adds is tower architecture, which other nations rebuild in their own form. */
const asMilitaryTower = (context: RomanDesignContext, build: () => void) => {
  const first = context.parts.length;
  build();
  for (const part of context.parts.slice(first)) part.militaryTower = true;
};
const ROMAN_ROUND_TOWER: RoundTowerStyle = { deck: "stone", shaft: "stone", trim: "stone" };
/** Castrum corner tower: a round stone drum on a battered plinth, a string course under the merlons. */
const romanCornerTower = (context: RomanDesignContext, plan: TowerPlan): RoundTower => {
  const { radius } = FORTRESS_CORNER;
  return { detailed: context.detailed, form: { base: radius - .02, crown: radius, top: radius - .02 },
    plan: { ...plan, base: AUTHORED_GROUND, deck: plan.deck + AUTHORED_GROUND,
      windows: plan.windows.map(window => ({ ...window, sill: window.sill + AUTHORED_GROUND })) },
    style: ROMAN_ROUND_TOWER, x: plan.x, z: plan.z };
};
const addRomanCornerTower = (context: RomanDesignContext, tower: RoundTower) => {
  const add: Add = part => context.parts.push({ stage: 1, ...part });
  const { form, plan, x, z } = tower, segments = towerSegments(context.detailed, form.crown);
  addRoundTowerBody(add, tower);
  add({ position: [x, plan.base + .14, z], radialSegments: segments, shape: "cylinder",
    size: [form.crown * 2, .28, form.crown * 2], stage: 1, surface: "stone", topScale: [.95, 1, .95] });
  add({ position: [x, plan.deck - .04, z], radialSegments: segments, shape: "cylinder",
    size: [form.crown * 2, .08, form.crown * 2], stage: 2, surface: "stone" });
  addMerlonCrown(add, tower, "stone");
  addRoundTowerSlits(add, tower, [[0, Math.sign(x) as 1 | -1]]);
};
/**
 * Look-out windows, filled in this order: the corner towers' outer faces (front first), then one
 * per keep side above the hall.
 */
const addFortressWindows = (context: RomanDesignContext, corners: readonly RoundTower[], keep: TowerPlan) => {
  const add: Add = part => context.parts.push({ stage: 1, ...part });
  for (const tower of corners) addRoundTowerWindow(add, tower, tower.plan.windows[0]!);
  const half = { 0: keep.width / 2, 2: keep.depth / 2 };
  for (const { axis, sign, sill } of keep.windows) lookoutWindow(context, axis === 0 ? keep.z : keep.x,
    sill + AUTHORED_GROUND, (axis === 0 ? keep.x : keep.z) + sign * half[axis], axis, sign);
};
export const addRomanFortress = (context: RomanDesignContext): RomanMilitaryAnchors => {
  const { part } = context;
  const plans = fortressTowerPlans();
  const corners = plans.filter(plan => plan.kind === "corner").map(plan => romanCornerTower(context, plan));
  const keep = plans.find(plan => plan.kind === "keep")!;
  asMilitaryTower(context, () => corners.forEach(tower => addRomanCornerTower(context, tower)));
  const positions: Point3[] = [-FORTRESS_CORNER.x, FORTRESS_CORNER.x].flatMap(x =>
    [-FORTRESS_CORNER.z, FORTRESS_CORNER.z].map((z): Point3 => [x, FORTRESS_CORNER.height + .04, z + .13]));
  romanRoom(context, 0, 0, 2.12, 1.56, 0.97, 0, 0.18, false);
  // Gate lintel is carried by masonry jambs rather than floating above the opening.
  part("stone", [0, 1.19, 0.78], [0.66, 0.15, 0.16], 2);
  // Central keep: a taller open deck, so the fortress shows more archer posts than any tower.
  const { depth, height, width, z } = FORTRESS_KEEP;
  asMilitaryTower(context, () => towerDeck(context, 0, z, height, width, depth));
  for (const side of [-1, 1]) positions.push([side * width * 0.36, height + 0.04, z]);
  for (const side of [-1, 1]) {
    part("stone", [side * 0.94, 1.22, 0], [0.25, 0.08, 1.55], 2);
    romanLadder(part, side * 0.82, 0.55, 1.28, 0.18, context.detailed ? 0.15 : 0.3);
  }
  asMilitaryTower(context, () => addFortressWindows(context, corners, keep));
  return { archerPositions: positions, flagAnchor: [0, height + 0.04, z - depth * 0.35] };
};
/** Look-out window a garrisoned soldier leans out of: wide enough for head and shoulders. */
const LOOKOUT_WINDOW = { height: 0.3, width: 0.23 };
/** A dark window panel with a stone sill on a wall's outer face (`face` along `axis`, outward `sign`). */
const lookoutWindow = (
  context: RomanDesignContext, along: number, sill: number, face: number, axis: 0 | 2, sign: number
) => {
  const { height, width } = LOOKOUT_WINDOW;
  const depth = 0.018;
  const at = (offset: number, y: number): [number, number, number] =>
    axis === 0 ? [face + sign * offset, y, along] : [along, y, face + sign * offset];
  const size = (thickness: number, tall: number, wide: number): [number, number, number] =>
    axis === 0 ? [thickness, tall, wide] : [wide, tall, thickness];
  context.part("dark", at(depth / 2, sill + height / 2), size(depth, height, width), 2);
  context.part("stone", at(0.02, sill - 0.02), size(0.06, 0.04, 0.3), 2);
};
const addWatchtowerWindows = (context: RomanDesignContext) => {
  const sill = WATCHTOWER_SILL;
  for (const side of [-1, 1]) lookoutWindow(context, 0, sill, side * 0.65, 0, side);
  lookoutWindow(context, 0, sill, -0.56, 2, -1);
  lookoutWindow(context, 0, sill, 0.615, 2, 1);
};
export const addRomanWatchtower = (context: RomanDesignContext): RomanMilitaryAnchors => {
  const deck = WATCHTOWER.height + 0.24, parapet = WATCHTOWER.height + 0.4;
  asMilitaryTower(context, () => addRomanWatchtowerBody(context));
  // Open crenellated deck (no canopy): archers stay in plain sight, as on the fortress towers.
  return {
    archerPositions: [
      [-0.44, deck + 0.045, 0.38],
      [0.44, deck + 0.045, 0.38],
      [0.44, deck + 0.045, -0.38]
    ],
    flagAnchor: [0, parapet + 0.125, -0.6]
  };
};
const addRomanWatchtowerBody = (context: RomanDesignContext) => {
  const { part } = context;
  const { depth, galleryDepth, galleryWidth, height, width } = WATCHTOWER;
  const deck = height + 0.24, parapet = height + 0.4;
  romanRoom(context, 0, 0, width, depth, height, 0, 0.18, false);
  for (const side of [-1, 1])
    for (const end of [-1, 1])
      part("stone", [side * 0.59, 0.18 + height / 2, end * 0.5], [0.18, height, 0.18], 1, "cylinder");
  addWatchtowerWindows(context);
  part("wood", [-0.6275, deck, 0], [0.295, 0.09, galleryDepth], 2);
  part("wood", [0.2875, deck, 0], [0.975, 0.09, galleryDepth], 2);
  part("wood", [-0.34, deck, 0.27], [0.28, 0.09, 0.8], 2);
  part("wood", [-0.34, deck, -0.575], [0.28, 0.09, 0.19], 2);
  romanLadder(part, -0.34, -0.3, height + 0.3);
  for (const side of [-1, 1]) {
    part("stone", [side * 0.725, parapet, 0], [0.1, 0.25, galleryDepth], 2);
    part("stone", [0, parapet, side * 0.61], [galleryWidth, 0.25, 0.1], 2);
  }
  for (const side of [-1, 1])
    for (const end of [-1, 1])
      part("stone", [side * 0.725, parapet, end * 0.61], [0.17, 0.25, 0.17], 2, "cylinder");
};
export const addRomanGuardTower = (
  context: RomanDesignContext,
  width: number
): RomanMilitaryAnchors => {
  const { depth, gap, height, width: towerWidth, z } = GUARD_TOWER;
  const x = width / 2 + gap + towerWidth / 2;
  asMilitaryTower(context, () => towerDeck(context, x, z, height, towerWidth, depth));
  const wall = context.parts.find(
    (piece) =>
      piece.stage === 1 &&
      Math.abs(piece.position[0] - (width / 2 - 0.055)) < 0.001 &&
      piece.size[0] === 0.11
  )!;
  // A side door links the hall to the tower; the eaves above cover the short passage.
  romanWallOpening(context, wall, z, 0.18, 0.32, 0.78, true);
  // A dark passage fills the doorway, like the tower's own: the gap shows an opening, not the hall floor.
  context.part("dark", [wall.position[0] - 0.01, 0.18 + 0.78 / 2, z], [0.09, 0.78, 0.318], 1);
  context.parts.at(-1)!.doorwayShadow = true;
  context.part("stone", [width / 2 + gap / 2, 0.2, z], [gap + 0.04, 0.04, 0.4], 1);
  return { archerPositions: [[x, height + 0.04, z + depth * 0.27], [x, height + 0.04, z - depth * 0.35]] };
};
