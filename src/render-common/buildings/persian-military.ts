import type { BuildingRecipe, Point3 } from "./building-recipe";
import {
  addFlagSocket, addRoundParapet, addRoundTowerBody, addRoundTowerGate, addRoundTowerPassage,
  addRoundTowerSlits, addRoundTowerWindow, aroundCrown, discSize, freeFaces, type RoundTower
} from "./military-round-tower";
import { militaryTowerPlans, type TowerPlan } from "./military-tower-plan";
import { type Add, type KitContext, runBetween } from "./nation-kit-parts";

const PALE_STONE: Point3 = [.93, .85, .72];

const persianTower = (plan: TowerPlan, context: KitContext): RoundTower => {
  const style = { deck: "plaster", shaft: "plaster", trim: plan.kind === "guard" ? "plaster" : "cut-stone" } as const;
  const common = { detailed: context.detailed, plan, style, x: plan.x, z: plan.z };
  if (plan.kind === "watch") return { ...common, form: { base: .64, crown: .785, top: .49 }, z: plan.z - .13 };
  if (plan.kind === "guard") return { ...common, form: { base: .35, crown: .36, top: .26 }, stretch: [.66, 1] };
  if (plan.kind === "keep") return { ...common, form: { base: .54, crown: .63, top: .41 }, stretch: [1, .8] };
  return { ...common, form: { base: .37, crown: .37, top: .285 } };
};

/** Broad stepped stone merlons replace both Roman blocks and Nubian pointed pinnacles. */
const addCrown = (add: Add, tower: RoundTower) => {
  const { detailed, form, plan } = tower;
  addRoundParapet(add, tower, .17, .085, "plaster");
  const count = plan.kind === "watch" ? 12 : 8;
  for (const { angle, x, z } of aroundCrown(tower, count, form.crown - .065)) {
    const rotation: Point3 = [0, angle, 0];
    add({ position: [x, plan.deck + .23, z], rotation, shape: "box", size: [.13, .16, .10],
      stage: 3, surface: "plaster" });
    add({ position: [x, plan.deck + .335, z], rotation, shape: "box", size: [.075, .05, .085],
      stage: 3, surface: "paint", tint: PALE_STONE });
    if (detailed) add({ position: [x, plan.deck + .375, z], rotation, shape: "box", size: [.035, .03, .065],
      stage: 3, surface: "plaster" });
  }
};

const addStoneCourses = (add: Add, tower: RoundTower) => {
  const { detailed, form, plan, x, z } = tower;
  const courses = detailed ? [.16, .5, .84] : [.16];
  for (const fraction of courses) {
    const y = plan.base + (plan.deck - plan.base) * fraction;
    const radius = form.base + (form.top - form.base) * fraction + .007;
    add({ position: [x, y, z], radialSegments: detailed ? 28 : 10, shape: "cylinder",
      size: discSize(tower, radius, .045), stage: 2, surface: "paint", tint: PALE_STONE });
  }
};

/** A domed sentry shelter leaves all three standing posts and the rear flag mast clear. */
const addWatchCanopy = (add: Add, tower: RoundTower) => {
  const { plan, x } = tower, base = plan.deck, z = plan.z + .11;
  const posts: Point3[] = [[x, base, plan.z + .58], [x + .52, base, plan.z + .1],
    [x, base, plan.z - .36], [x - .52, base, plan.z + .1]];
  for (const at of posts) add({ position: [at[0], base + .44, at[2]], radialSegments: tower.detailed ? 8 : 4,
    shape: "cylinder", size: [.055, .88, .055], stage: 3, surface: "plaster" });
  for (let index = 0; index < posts.length; index++) {
    const from: Point3 = [...posts[index]!], to: Point3 = [...posts[(index + 1) % posts.length]!];
    from[1] += .88; to[1] += .88;
    runBetween(add, from, to, [.085, .06], { stage: 3, surface: "cut-stone" });
  }
  add({ position: [x, base + .925, z], radialSegments: tower.detailed ? 24 : 10,
    shape: "cylinder", size: [1.16, .075, 1.12], stage: 3, surface: "plaster" });
  add({ position: [x, base + .9625, z], shape: "dome", size: [1.16, .8, 1.12],
    stage: 3, surface: "roof" });
};

/** New tapering shafts share the canonical decks, windows, door and military standing positions. */
export const addPersianMilitaryTowers = (context: KitContext, original: BuildingRecipe) => {
  const plans = militaryTowerPlans(context.typeId, original);
  if (!plans.length) return;
  const add: Add = part => context.add({ ...part, militaryTower: true });
  const towers = plans.map(plan => persianTower(plan, context));
  for (const tower of towers) {
    addRoundTowerBody(add, tower); addStoneCourses(add, tower); addCrown(add, tower);
    const blocked: Array<[0 | 2, number]> = [];
    if (tower.plan.kind === "watch") blocked.push([2, 1]);
    if (tower.plan.kind === "guard") { blocked.push([0, -1]); addRoundTowerPassage(add, tower, -1); }
    addRoundTowerSlits(add, tower, freeFaces(tower, blocked));
  }
  for (const tower of towers) for (const window of tower.plan.windows) addRoundTowerWindow(add, tower, window);
  const watch = towers.find(tower => tower.plan.kind === "watch");
  if (!watch) return;
  addRoundTowerGate(add, watch, context.door, "plaster");
  addWatchCanopy(add, watch);
  if (original.flagAnchor) addFlagSocket(add, watch, original.flagAnchor, .085, "plaster");
};

/** Battered piers turn the occupational lookout into a domed Persian observation chamber. */
export const addPersianLookoutPiers = (context: KitContext) => {
  if (context.typeId !== 14) return;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) context.add({
    position: [sx * .48, 1.19, sz * .27], shape: "bevel-box", size: [.2, 2.38, .18],
    stage: 1, surface: "plaster", topScale: [.45, 1, .6]
  });
};
