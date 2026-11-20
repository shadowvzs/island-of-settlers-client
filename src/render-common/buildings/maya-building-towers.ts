import type { Point3 } from "./building-recipe";
import { createWindowShadowPane } from "./building-window-shadows";
import { addMayaFret, MAYA_PLASTER, MAYA_STONE, type MayaBuildingKit } from "./maya-building-kit";
import { militaryTowerPlans, type TowerPlan } from "./military-tower-plan";
import { doorGapOf } from "./nation-kit-parts";

interface Opening { from: number; to: number; bottom: number; top: number }

/** Masonry is tessellated around real windows and the shared civilian entrance, never over them. */
const addTowerWall = (kit: MayaBuildingKit, plan: TowerPlan, axis: 0 | 2, sign: -1 | 1) => {
  const { add, original } = kit, along = axis === 0 ? 2 : 0;
  const centre: Point3 = [plan.x, 0, plan.z];
  const span = along === 0 ? plan.width : plan.depth, across = axis === 0 ? plan.width : plan.depth;
  const start = centre[along] - span / 2, end = centre[along] + span / 2;
  const face = centre[axis] + sign * (across / 2 - .05), openings: Opening[] = [];
  const window = plan.windows.find(entry => entry.axis === axis && entry.sign === sign);
  if (window) {
    openings.push({ bottom: window.sill, from: centre[along] - .12,
      to: centre[along] + .12, top: window.sill + .38 });
    const position: Point3 = [plan.x, window.sill + .19, plan.z];
    const size: Point3 = [.24, .38, .24], outward: Point3 = [0, 0, 0];
    position[axis] = face + sign * .054; size[axis] = .018; outward[axis] = sign;
    add({ ...createWindowShadowPane({ position, size, shape: "box", surface: "dark", stage: 2 }, .08, outward),
      windowShadowDecorative: true });
  }
  const door = doorGapOf(original);
  if (axis === 2 && sign === 1 && Math.abs(face - door.z) < .24 &&
    door.left >= start - .03 && door.right <= end + .03)
    openings.push({ bottom: 0, from: door.left, to: door.right,
      top: Math.max(door.top, door.spring + (door.right - door.left) / 2) + .015 });
  const xs = [...new Set([start, end, ...openings.flatMap(opening => [opening.from, opening.to])])]
    .filter(value => value >= start && value <= end).sort((a, b) => a - b);
  const stepBottom = Math.max(door.top + .1, plan.deck * .42);
  const stepTop = Math.min(plan.deck * .67, ...plan.windows.map(entry => entry.sill - .08));
  const stepped = stepTop > stepBottom + .08;
  const ys = [...new Set([plan.base, plan.deck, ...openings.flatMap(opening => [opening.bottom, opening.top]),
    ...stepped ? [stepBottom, stepTop] : []])]
    .filter(value => value >= plan.base && value <= plan.deck).sort((a, b) => a - b);
  for (let ix = 0; ix < xs.length - 1; ix++) for (let iy = 0; iy < ys.length - 1; iy++) {
    const x = (xs[ix]! + xs[ix + 1]!) / 2, y = (ys[iy]! + ys[iy + 1]!) / 2;
    if (openings.some(opening => x > opening.from && x < opening.to &&
      y > opening.bottom && y < opening.top)) continue;
    const inset = stepped && y > stepBottom && y < stepTop ? .055 : 0;
    const from = Math.max(xs[ix]!, start + inset), to = Math.min(xs[ix + 1]!, end - inset);
    if (to - from <= .001) continue;
    const position: Point3 = [plan.x, y, plan.z], size: Point3 = [.1, ys[iy + 1]! - ys[iy]!, .1];
    position[along] = (from + to) / 2; position[axis] = face - sign * inset; size[along] = to - from;
    add({ militaryTower: true, position, shape: "box", size, stage: 1,
      surface: "plaster", tint: MAYA_PLASTER });
  }
};

const addTowerCrown = (kit: MayaBuildingKit, plan: TowerPlan) => {
  const { add, detailed } = kit;
  add({ militaryTower: true, position: [plan.x, plan.deck - .035, plan.z], shape: "box",
    size: [plan.width, .07, plan.depth], stage: 2, surface: "cut-stone", tint: MAYA_STONE });
  for (const axis of [0, 2] as const) for (const side of [-1, 1] as const) {
    const span = axis === 0 ? plan.width : plan.depth;
    const position: Point3 = [plan.x, plan.deck + .1, plan.z];
    position[axis === 0 ? 2 : 0] += side * ((axis === 0 ? plan.depth : plan.width) / 2 - .035);
    const size: Point3 = axis === 0 ? [span, .2, .07] : [.07, .2, span];
    add({ militaryTower: true, position, shape: "box", size, stage: 3, surface: "plaster" });
    for (const drop of [.13, .24]) {
      const band: Point3 = [...position]; band[1] = plan.deck - drop;
      add({ militaryTower: true, position: band, shape: "bevel-box",
        size: axis === 0 ? [span, .055, .085] : [.085, .055, span],
        stage: 3, surface: "cut-stone", tint: MAYA_STONE });
    }
    if (detailed && span > .6) {
      const fret: Point3 = [...position]; fret[1] = plan.base + (plan.deck - plan.base) * .57;
      addMayaFret(add, fret, Math.min(.4, span * .45), .25, .06,
        axis === 0 ? 0 : Math.PI / 2, true);
    }
    const count = detailed ? Math.max(3, Math.round(span / .2)) : 3;
    for (let index = 0; index < count; index++) {
      const step: Point3 = [...position];
      step[axis] += -span * .4 + span * .8 * index / (count - 1);
      step[1] = plan.deck + .225;
      add({ militaryTower: true, position: step, shape: "bevel-box",
        size: axis === 0 ? [.11, .05, .08] : [.08, .05, .11], stage: 4,
        surface: "cut-stone", tint: MAYA_STONE });
    }
  }
};

/** Squared limestone towers differ from Rome's drums while retaining every archer post and window. */
export const addMayaMilitaryTowers = (kit: MayaBuildingKit) => {
  for (const plan of militaryTowerPlans(kit.definition.id, kit.original)) {
    for (const axis of [0, 2] as const) for (const sign of [-1, 1] as const)
      addTowerWall(kit, plan, axis, sign);
    addTowerCrown(kit, plan);
  }
};
