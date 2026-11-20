import { DMath } from "../../shared/math/deterministic-math";
import type { SettlerNation as WorkerNation } from "../workers/worker-unit";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { addJapaneseWatchHip } from "./japanese-tower-hip";
import {
  addFlagSocket, addRoundParapet, addRoundTowerBody, addRoundTowerGate, addRoundTowerPassage, addRoundTowerSlits,
  addRoundTowerWindow, aroundCrown, discSize, freeFaces, GATE_HEAD, GATE_JAMB,   type RoundTower, type RoundTowerForm, type RoundTowerStyle,
shaftRadius, shaftTop, towerSegments} from "./military-round-tower";
import { militaryTowerPlans, type TowerKind, type TowerPlan } from "./military-tower-plan";
import {
  addYaguraDoorway, addYaguraTower, addYaguraWindow, YAGURA_WATCHTOWER_LOOKOUT, type YaguraForm, type YaguraTower
} from "./military-yagura-tower";
import { japaneseDoor } from "./nation-kit-japanese";
import { nubianDoor } from "./nation-kit-nubian";
import type { Add, KitContext } from "./nation-kit-parts";
import { vikingDoor } from "./nation-kit-viking";

type BuildNation = Exclude<WorkerNation, "roman">;
type RoundNation = Exclude<BuildNation, "japanese">;

/**
 * Per-nation tower forms (owner decision 2026-10-12): Viking round timber towers with an
 * overhanging fighting gallery, Nubian round tapered mud-brick towers with pinnacles. Crowns are
 * sized so every archer post stands clear inside the parapet.
 */
const ROUND_FORMS: Readonly<Record<RoundNation, Readonly<Record<TowerKind, RoundTowerForm>>>> = {
  nubian: { corner: { base: .38, crown: .35, top: .32 }, guard: { base: .37, crown: .37, top: .32 },
    keep: { base: .6, crown: .56, top: .52 }, watch: { base: .62, crown: .77, top: .58 } },
  viking: { corner: { base: .32, crown: .38, top: .32 }, guard: { base: .3, crown: .37, top: .3 },
    keep: { base: .5, crown: .6, top: .5 }, watch: { base: .62, crown: .78, top: .62 } }
};
/**
 * The guard tower stands between the hall's eaves and the plot edge: an oval plan keeps its crown
 * off the hall roof while the deck stays long enough for both archer posts.
 */
const GUARD_STRETCH = [.72, 1] as const;
const ROUND_STYLES: Readonly<Record<RoundNation, RoundTowerStyle>> = {
  nubian: { deck: "plaster", shaft: "plaster", trim: "plaster" },
  viking: { deck: "wood", shaft: "wood", trim: "wood" }
};
/** Round watchtowers stand back from the shared door, which their flat gate bay frames. */
const WATCH_SETBACK = -.1;
/** Japanese yagura: the Roman square footprint on a battered stone base. */
const YAGURA_FORMS: Readonly<Record<TowerKind, YaguraForm>> = {
  corner: { base: .9, batter: .05, depth: .72, width: .72 },
  guard: { base: .8, batter: .04, depth: .72, width: .48 },
  keep: { base: 1.05, batter: .05, depth: .85, width: 1.14 },
  watch: { base: 1, batter: .06, depth: 1.12, gallery: { depth: 1.34, width: 1.55 }, width: 1.3 }
};
/** Untagged leftovers (corner quoins, inner ladders) this close around a rebuilt tower go with it. */
const LEFTOVER_MARGIN = .06;
/** Merlon and shield boxes reach slightly past the crown radius. */
const CROWN_SLACK = .025;
/** How far details stand out from the shaft foot: Viking stone footing, Nubian palm-beam ends. */
const SHAFT_OUTSET: Readonly<Record<RoundNation, number>> = { nubian: .065, viking: .03 };

const SHIELD_TINTS: readonly Point3[] = [[.78, .2, .13], [.9, .7, .3], [.3, .4, .62]];
const PINNACLES: Readonly<Record<TowerKind, number>> = { corner: 4, guard: 4, keep: 6, watch: 8 };

const isLeftover = (part: BuildingPart, plans: readonly TowerPlan[]) => {
  if (part.stock) return false;
  const { max, min } = getRomanPartBounds(part);
  return plans.some(plan => min[0] >= plan.x - plan.width / 2 - LEFTOVER_MARGIN &&
    max[0] <= plan.x + plan.width / 2 + LEFTOVER_MARGIN && min[2] >= plan.z - plan.depth / 2 - LEFTOVER_MARGIN &&
    max[2] <= plan.z + plan.depth / 2 + LEFTOVER_MARGIN && max[1] <= plan.deck + LEFTOVER_MARGIN);
};

/** The Roman recipe without its towers: the nation kit rebuilds walls and roofs around them. */
export const withoutMilitaryTowers = (recipe: BuildingRecipe, typeId: number): BuildingRecipe => {
  const plans = militaryTowerPlans(typeId, recipe);
  if (!plans.length) return recipe;
  return { ...recipe, parts: recipe.parts.filter(part => !part.militaryTower && !isLeftover(part, plans)) };
};

/** Keeps a round crown inside the plot envelope by moving the tower towards the building centre. */
const towardsCentre = (center: number, reach: number, extent: number) =>
  Math.sign(center) * Math.min(Math.abs(center), extent - reach);

/** Garrisoned watchtower look-out on round shafts: 10 cm taller opening (same lintel), 12 cm sill block. */
const ROUND_WATCHTOWER_LOOKOUT = { drop: .1, sillDepth: .12 } as const;

const roundTower = (plan: TowerPlan, nation: RoundNation, context: KitContext): RoundTower => {
  const form = ROUND_FORMS[nation][plan.kind], stretch = plan.kind === "guard" ? GUARD_STRETCH : undefined;
  const reach = (scale: number) =>
    Math.max(form.base * scale + SHAFT_OUTSET[nation], form.crown * scale + CROWN_SLACK);
  const z = plan.z + (plan.kind === "watch" ? WATCH_SETBACK : 0), { extentX, extentZ } = context.limit;
  // Watchtower look-outs are too small for a soldier leaning on the sill: taller, with a deeper sill.
  const lookout = context.typeId === 4 ? ROUND_WATCHTOWER_LOOKOUT : undefined;
  return { detailed: context.detailed, form, lookout, plan, stretch, style: ROUND_STYLES[nation],
    x: towardsCentre(plan.x, reach(stretch?.[0] ?? 1), extentX),
    z: towardsCentre(z, reach(stretch?.[1] ?? 1), extentZ) };
};

/** Pointed palisade boards on a low rail (High); Minimal keeps a plain timber breastwork. */
const addStakeCrown = (add: Add, tower: RoundTower) => {
  const { detailed, form, plan } = tower, thickness = .07;
  if (!detailed) { addRoundParapet(add, tower, .26, thickness, "wood"); return; }
  addRoundParapet(add, tower, .1, thickness, "wood");
  const count = Math.round(form.crown * Math.PI * 2 / .13), width = form.crown * Math.PI * 2 / count * .84;
  for (const { angle, x, z } of aroundCrown(tower, count, form.crown - .03)) {
    const rotation: Point3 = [0, angle, 0];
    add({ position: [x, plan.deck + .17, z], rotation, shape: "box", size: [width, .22, .045], stage: 3,
      surface: "wood" });
    add({ position: [x, plan.deck + .315, z], rotation, shape: "gable", size: [width, .07, .045], stage: 3,
      surface: "wood" });
  }
};

/** Painted round shields hung on the gallery boards of the larger towers. */
const addShields = (add: Add, tower: RoundTower) => {
  if (!tower.detailed || !["keep", "watch"].includes(tower.plan.kind)) return;
  aroundCrown(tower, 6, tower.form.crown + .012, .25).forEach(({ angle, x, z }, index) => add({
    position: [x, tower.plan.deck + .17, z], radialSegments: 10, rotation: [Math.PI / 2, angle, 0], shape: "cylinder",
    size: [.15, .02, .15], stage: 3, surface: "paint", tint: SHIELD_TINTS[index % SHIELD_TINTS.length] }));
};

/** Stone footing, timber bands and (High) braces under the overhanging gallery. */
const addVikingTimberwork = (add: Add, tower: RoundTower) => {
  const { detailed, form, plan, x, z } = tower, segments = towerSegments(detailed, form.base);
  add({ position: [x, plan.base + .07, z], radialSegments: segments, shape: "cylinder",
    size: discSize(tower, form.base + .03, .14), stage: 1, surface: "stone" });
  if (!detailed) return;
  const top = shaftTop(tower), band = form.base + .015;
  for (const fraction of [.38, .72]) add({ innerRadius: .5 * (form.base - .02) / band,
    position: [x, plan.base + (top - plan.base) * fraction, z], radialSegments: segments, shape: "ring",
    size: discSize(tower, band, .05), stage: 2, surface: "wood" });
  const reach = form.crown - form.top, rise = .3;
  if (reach < .04) return;
  const tilt = DMath.atan2(reach, rise), length = DMath.hypot(reach, rise), middle = form.top + reach / 2 - .02;
  for (const { angle, x: braceX, z: braceZ } of aroundCrown(tower, 8, middle, 0)) add({
    position: [braceX, top - rise / 2, braceZ], rotation: [tilt, angle, 0], shape: "box", size: [.05, length, .05],
    stage: 2, surface: "wood" });
};

/** Tapered pinnacles round a mud-brick parapet, small stepped merlons between them on High. */
const addPinnacleCrown = (add: Add, tower: RoundTower) => {
  const { detailed, form, plan } = tower, thickness = .08;
  addRoundParapet(add, tower, .2, thickness, "plaster");
  const count = PINNACLES[tower.plan.kind];
  for (const { x, z } of aroundCrown(tower, count, form.crown - .065)) {
    // Minimal draws each pinnacle as one pointed shaft.
    if (!detailed) {
      add({ position: [x, plan.deck + .22, z], radialSegments: 6, shape: "cylinder", size: [.13, .44, .13], stage: 3,
        surface: "plaster", topScale: [.2, 1, .2] });
      continue;
    }
    add({ position: [x, plan.deck + .16, z], shape: "cylinder", size: [.13, .32, .13], stage: 3, surface: "plaster",
      topScale: [.7, 1, .7] });
    add({ position: [x, plan.deck + .38, z], shape: "cone", size: [.1, .12, .1], stage: 3, surface: "plaster" });
  }
  if (!detailed) return;
  for (const { x, z } of aroundCrown(tower, count * 2, form.crown - thickness / 2, 0)) add({
    position: [x, plan.deck + .245, z], shape: "cone", size: [.07, .09, .07], stage: 3, surface: "plaster" });
};

/** Rows of palm-beam ends (toron) projecting from the mud brick (High). */
const addToron = (add: Add, tower: RoundTower) => {
  const { detailed, plan } = tower;
  if (!detailed) return;
  const top = shaftTop(tower);
  for (const fraction of [.3, .62, .92]) {
    const y = plan.base + (top - plan.base) * fraction, radius = shaftRadius(tower, y);
    const count = Math.max(6, Math.round(radius * Math.PI * 2 / .32));
    for (const { angle, x, z } of aroundCrown(tower, count, radius + .015, fraction * 2)) add({
      position: [x, y, z], radialSegments: 5, rotation: [Math.PI / 2, angle, 0], shape: "cylinder",
      size: [.045, .1, .045], stage: 3, surface: "wood" });
  }
};

const addRoundNationTower = (add: Add, tower: RoundTower, nation: RoundNation) => {
  addRoundTowerBody(add, tower);
  if (nation === "viking") {
    addVikingTimberwork(add, tower);
    addStakeCrown(add, tower);
    addShields(add, tower);
  } else {
    addToron(add, tower);
    addPinnacleCrown(add, tower);
  }
  const blocked: Array<[0 | 2, number]> = [];
  if (tower.plan.kind === "watch") blocked.push([2, 1]);
  if (tower.plan.kind === "guard") {
    blocked.push([0, -1]);
    addRoundTowerPassage(add, tower, -1);
  }
  addRoundTowerSlits(add, tower, freeFaces(tower, blocked));
};

const yaguraTower = (plan: TowerPlan, context: KitContext): YaguraTower => {
  let form: YaguraForm = YAGURA_FORMS[plan.kind];
  if (plan.kind === "watch") form = { ...form, front: context.door.z - .03 };
  // White timber-framed plaster extends down to a low real footing, as on the upper storeys.
  // Tower decks/windows keep their original coordinates and garrison contracts.
  if ([4, 9].includes(context.typeId)) form = { ...form, base: .12 };
  // Watchtower look-outs are too small for a soldier leaning on the sill: taller, with a sill ledge.
  const lookout = context.typeId === 4 ? YAGURA_WATCHTOWER_LOOKOUT : undefined;
  return { detailed: context.detailed, form, lookout, plan, x: plan.x, z: plan.z };
};

/**
 * Round watchtower entrance: the gate bay with the nation's door surround; a Viking plank canopy
 * or Nubian pinnacles on the gate jambs.
 */
const addRoundGate = (add: Add, context: KitContext, nation: RoundNation, tower: RoundTower) => {
  const { door } = context, style = ROUND_STYLES[nation], top = tower.plan.base + door.top + GATE_HEAD;
  addRoundTowerGate(add, tower, door, style.shaft);
  if (nation === "nubian") {
    nubianDoor(context);
    for (const x of [door.left - GATE_JAMB / 2, door.right + GATE_JAMB / 2]) add({
      position: [x, top + .07, door.z - .09], shape: "cone", size: [.11, .14, .11], stage: 3, surface: "plaster" });
    return;
  }
  vikingDoor(context);
  const width = door.right - door.left + GATE_JAMB * 2 + .08;
  add({ position: [(door.left + door.right) / 2, top + .03, door.z + .02], rotation: [.45, 0, 0], shape: "box",
    size: [width, .035, .3], stage: 3, surface: "wood" });
};

/** Japanese towers: yagura bodies, then windows in their filling order, then the watchtower door. */
const addYaguraTowers = (add: Add, plans: readonly TowerPlan[], context: KitContext) => {
  const towers = plans.map(plan => yaguraTower(plan, context));
  towers.forEach(tower => addYaguraTower(add, tower));
  for (const tower of towers) for (const window of tower.plan.windows) addYaguraWindow(add, tower, window);
  if(context.typeId===9)for(const tower of towers)addJapaneseWatchHip({...context,add},tower);
  const watch = towers.find(tower => tower.plan.kind === "watch");
  if (!watch) return;
  addYaguraDoorway(add, watch, context.door);
  japaneseDoor(context);
  if (context.typeId === 4) addJapaneseWatchHip({ ...context, add }, watch);
};

/** Round towers: bodies, then windows in their filling order, then the watchtower gate and flag socket. */
const addRoundTowers = (add: Add, plans: readonly TowerPlan[], context: KitContext, nation: RoundNation,
  flag: Point3 | undefined) => {
  const towers = plans.map(plan => roundTower(plan, nation, context));
  towers.forEach(tower => addRoundNationTower(add, tower, nation));
  for (const tower of towers) for (const window of tower.plan.windows) addRoundTowerWindow(add, tower, window);
  const watch = towers.find(tower => tower.plan.kind === "watch");
  if (!watch) return;
  addRoundGate(add, context, nation, watch);
  if (flag) addFlagSocket(add, watch, flag, nation === "viking" ? .07 : .08, ROUND_STYLES[nation].trim);
};

/**
 * Rebuilds the guardhouse, watchtower and fortress towers in the nation's own form on the Roman
 * plans: same decks under every archer post, same look-out windows (in filling order), door and flag.
 */
export const addNationTowers = (original: BuildingRecipe, context: KitContext, nation: BuildNation) => {
  const plans = militaryTowerPlans(context.typeId, original), parts: BuildingPart[] = [];
  const add: Add = part => parts.push({ stage: 1, ...part });
  if (!plans.length) return parts;
  if (nation === "japanese") addYaguraTowers(add, plans, context);
  else addRoundTowers(add, plans, context, nation, original.flagAnchor);
  return parts;
};
