import { lerp3 } from "../../shared/world/noise";
import { createRandom, type Random } from "../../shared/world/rng";
import type { Vec3 } from "../props/mesh-builder";
import { add, fromAngles, scale } from "../props/tree-parts";
import { taperRadii } from "./limb-growth";
import { finishModel } from "./model-bounds";
import { PALM_CELL } from "./palm-atlas";
import { type FrondPlan,growFrond } from "./palm-frond";
import { getPalmArchetype, getPalmStage, type PalmArchetype, type PalmStage } from "./palm-shapes";
import { createEmptyModel, type GrowthStage, type TreeModel } from "./tree-model";

const GOLDEN_ANGLE = 2.39996;
const TRUNK_POINTS = 10;
/** Share of the mature old leaf bases a stage shows (the oldest stay on young trunks). */
const LEAF_BASE_SHARE: Record<GrowthStage, number> = { 1: 0, 2: 0, 3: 0.4, 4: 0.8, 5: 1 };
/** Share of the mature fruit a stage carries. */
const FRUIT_SHARE: Record<GrowthStage, number> = { 1: 0, 2: 0, 3: 0, 4: 0.4, 5: 1 };

interface PalmContext {
  archetype: PalmArchetype;
  model: TreeModel;
  params: PalmStage;
  random: Random;
  stage: GrowthStage;
}

/** The grown trunk: its axis, crown top, lean direction and radius below the crown. */
interface PalmTrunk {
  points: Vec3[];
  radius: number;
  top: Vec3;
  yaw: number;
}

/** Swollen foot, slim body, a slight bulge where the crown shaft starts. */
const getTrunkRadii = (archetype: PalmArchetype, radius: number) => {
  const radii = taperRadii(TRUNK_POINTS, radius, radius * 0.86, 0.6);
  radii[0] = radius * archetype.swell;
  radii[1] = radius * (1 + (archetype.swell - 1) * 0.35);
  radii[TRUNK_POINTS - 1] = radius * 0.98;
  return radii;
};

/**
 * Quadratic Bezier trunk: it bows (or, for the leaning hero, leans far out) and turns back up
 * towards the crown; a seedling has only a ground crown (no visible trunk).
 */
const growTrunk = (context: PalmContext): PalmTrunk => {
  const { archetype, params, random } = context;
  const height = Math.max(0.08, archetype.height * params.trunk);
  const radius = archetype.trunkRadius * params.trunkRadius;
  const yaw = random() * Math.PI * 2;
  const bow = height * archetype.lean * (0.75 + random() * 0.5);
  const lean: Vec3 = [Math.cos(yaw), 0, Math.sin(yaw)];
  const control = add(scale(lean, bow * 1.5), [0, height * 0.4, 0]);
  const top = add(scale(lean, bow * 1.2), [0, height, 0]);
  const points = Array.from({ length: TRUNK_POINTS }, (_, index): Vec3 => {
    const t = index / (TRUNK_POINTS - 1);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    return [
      b * control[0] + c * top[0],
      -0.05 + b * control[1] + c * (top[1] + 0.05),
      b * control[2] + c * top[2]
    ];
  });
  const radii = getTrunkRadii(archetype, radius);
  points.push(add(top, [0, radius * 1.1, 0]));
  radii.push(radius * 0.32);
  context.model.wood.push({ depth: 0, phase: random(), points, radii, sway: [0, 0.25] });
  return { points, radius, top, yaw };
};

/** Atlas cell by age layer: fresh young centre, mature greens, old and damaged outer fronds. */
const pickFrondCell = (archetype: PalmArchetype, age: number, damaged: boolean, random: Random) => {
  if (archetype.blade === "fan") return PALM_CELL.fan01;
  if (damaged) return PALM_CELL.dryTip01;
  if (age < 0.18) return PALM_CELL.young01;
  if (age > 0.8) return PALM_CELL.old01;
  const dark = archetype.juvenile === "date" ? 0.8 : 0.25;
  return random() < dark ? PALM_CELL.green02 : PALM_CELL.green01;
};

/** Azimuth on a jittered golden spiral, pulled towards the lean in one sided crowns. */
const getFrondAzimuth = (context: PalmContext, index: number, yaw: number) => {
  const azimuth = index * GOLDEN_ANGLE + (context.random() - 0.5) * 0.7;
  return azimuth - context.archetype.asymmetry * 0.9 * Math.sin(azimuth - yaw);
};

/** Elevation by age layer: upright young centre, radial middle, old fronds angle down. */
const getFrondElevation = (context: PalmContext, age: number, old: number) => {
  const { params, random } = context;
  const upright = params.upright * (1 - age * 0.5);
  const fall = age * 1.45 * params.spread;
  const elevation = 1.3 - fall - old * 0.2 + upright + (random() - 0.5) * 0.25;
  return Math.min(1.5, elevation);
};

/** One frond's plan from its age (0 newest .. 1 oldest) and the stage's ageing. */
const planFrond = (context: PalmContext, age: number, azimuth: number): FrondPlan => {
  const { archetype, params, random } = context;
  const old = age * params.ageing;
  const damaged = old > 0.72 && random() < archetype.damage;
  const dead = damaged && old > 0.9 && random() < archetype.damage * 0.5;
  const length =
    archetype.frondLength *
    params.length *
    (0.78 + Math.sin(age * Math.PI) * 0.28 + (random() - 0.5) * 0.12);
  const narrow = age < 0.2 && context.stage >= 3 ? 0.75 : 1;
  return {
    age: old,
    azimuth,
    bentTip: damaged && random() < 0.5,
    blade: archetype.blade,
    cell: pickFrondCell(archetype, old, damaged, random),
    droop: 0.12 + old * 0.45,
    dry: dead ? 0.85 : 0,
    elevation: dead ? -1.1 : getFrondElevation(context, age, old),
    fold: archetype.fold + Math.pow(1 - age, 3) * 0.35,
    gravity: archetype.gravity * params.gravity * (0.55 + age * 0.9) * (0.85 + random() * 0.3),
    length,
    petiole: archetype.petiole,
    shade: Math.min(1, 0.55 + (1 - age) * 0.3 + random() * 0.15 - old * 0.08),
    span: archetype.span * length * params.span * narrow,
    twist: old * 0.5
  };
};

const isJuvenileFan = (context: PalmContext) =>
  context.archetype.blade === "fan" && context.stage <= 3;

/**
 * Young fan palm: separate upright fans on long visible stalks of varied length and angle
 * (they stand at different heights, facing outwards), never one dome of overlapping fans.
 */
const planJuvenileFan = (plan: FrondPlan, random: Random): FrondPlan => {
  const length = plan.length * (0.7 + random() * 0.6);
  return {
    ...plan,
    droop: 0.04,
    elevation: 0.8 + random() * 0.55,
    gravity: plan.gravity * 0.5,
    length,
    petiole: 0.72,
    span: plan.span * 0.6 * (length / plan.length)
  };
};

/**
 * Crown in vertical layers: young upright fronds on top, the radial main crown, old drooping
 * fronds lowest; each leaves the crown shaft surface, never from one point like wheel spokes.
 */
const growCrown = (context: PalmContext, trunk: PalmTrunk) => {
  const { archetype, params } = context;
  const count = params.fronds;
  const depth = Math.min(archetype.crownDepth * params.length * 1.2, trunk.top[1] * 0.7);
  for (let index = 0; index < count; index += 1) {
    const age = count > 1 ? index / (count - 1) : 0.5;
    const azimuth = getFrondAzimuth(context, index, trunk.yaw);
    const out = fromAngles(azimuth, 0);
    const attach = add(trunk.top, add(scale(out, trunk.radius * 0.6), [0, -age * depth, 0]));
    const plan = planFrond(context, age, azimuth);
    const shaped = isJuvenileFan(context) ? planJuvenileFan(plan, context.random) : plan;
    context.model.fronds.push(growFrond(attach, shaped, context.random));
  }
};

/** Dead fan leaves hanging against the trunk below the crown (fan palm skirt). */
const growDeadSkirt = (context: PalmContext, trunk: PalmTrunk) => {
  const { archetype, params, random } = context;
  const count = Math.round(archetype.deadSkirt * Math.max(0, params.ageing - 0.5) * 2);
  for (let index = 0; index < count; index += 1) {
    const azimuth = index * GOLDEN_ANGLE + random() * 0.5;
    const drop = archetype.crownDepth + 0.1 + random() * 0.35;
    const attach = add(trunk.top, add(scale(fromAngles(azimuth, 0), trunk.radius), [0, -drop, 0]));
    const length = 0.9 + random() * 0.3;
    const plan: FrondPlan = {
      ...planFrond(context, 1, azimuth),
      cell: PALM_CELL.fan01,
      dry: 1,
      elevation: -1.25 - random() * 0.2,
      gravity: 0,
      length,
      petiole: 0.3,
      span: archetype.span * archetype.frondLength * 0.7
    };
    context.model.fronds.push(growFrond(attach, plan, random));
  }
};

/** Point at a fraction of the trunk axis (linear between its points). */
const pointOnTrunk = (points: Vec3[], fraction: number) => {
  const position = Math.min(1, Math.max(0, fraction)) * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(position));
  return lerp3(points[index]!, points[index + 1]!, position - index);
};

/**
 * Cut petiole stubs at the crown / trunk transition (date palms: far down the trunk), as short
 * dead wood limbs (depth 1) after the trunk.
 */
const growLeafBases = (context: PalmContext, trunk: PalmTrunk) => {
  const { archetype, random, stage } = context;
  const count = Math.round(archetype.leafBases * LEAF_BASE_SHARE[stage]);
  for (let index = 0; index < count; index += 1) {
    const fraction =
      0.97 - (index / Math.max(1, count)) * archetype.leafBaseReach - random() * 0.04;
    const azimuth = index * GOLDEN_ANGLE + random() * 0.6;
    const direction = fromAngles(azimuth, 0.9 + random() * 0.35);
    const position = add(
      pointOnTrunk(trunk.points, fraction),
      scale(fromAngles(azimuth, 0), trunk.radius * 0.7)
    );
    const length = 0.1 + random() * 0.1;
    const radius = trunk.radius * (0.22 + random() * 0.08);
    context.model.wood.push({
      dead: true,
      depth: 1,
      phase: 0,
      points: [position, add(position, scale(direction, length))],
      radii: [radius, radius * 0.7],
      sway: [0, 0]
    });
  }
};

const DATE_GREEN: Vec3 = [0.32, 0.43, 0.15];
const DATE_GOLD: Vec3 = [0.86, 0.61, 0.14];
const DATE_AMBER: Vec3 = [0.70, 0.33, 0.075];
const DATE_DARK: Vec3 = [0.36, 0.16, 0.045];

const getDateTone = (ripeness: number, random: Random): Vec3 => {
  const tint = 0.95 + random() * 0.10;
  const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [
    (a[0] + (b[0] - a[0]) * t) * tint,
    (a[1] + (b[1] - a[1]) * t) * tint,
    (a[2] + (b[2] - a[2]) * t) * tint
  ];
  if (ripeness < 0.18) return [DATE_GREEN[0] * tint, DATE_GREEN[1] * tint, DATE_GREEN[2] * tint];
  if (ripeness < 0.45) return mix(DATE_GREEN, DATE_GOLD, (ripeness - 0.18) / 0.27);
  if (ripeness < 0.78) return mix(DATE_GOLD, DATE_AMBER, (ripeness - 0.45) / 0.33);
  return mix(DATE_AMBER, DATE_DARK, (ripeness - 0.78) / 0.22);
};

/** Branched date inflorescence: several strands hang from each stalk, ripening unevenly. */
const growDateBunches = (context: PalmContext, trunk: PalmTrunk) => {
  const { archetype, random, stage } = context;
  const bunches = Math.round(5 * FRUIT_SHARE[stage]), strands = 3, perStrand = 6;
  if (bunches === 0) return;
  for (let bunch = 0; bunch < bunches; bunch += 1) {
    const angle = bunch * GOLDEN_ANGLE + random() * 0.5;
    const attach = add(trunk.top, [
      Math.cos(angle) * trunk.radius * 1.45,
      -0.06,
      Math.sin(angle) * trunk.radius * 1.45
    ]);
    for (let strand = 0; strand < strands; strand += 1) {
      const strandAngle = angle + (strand - 1) * 0.55 + (random() - 0.5) * 0.15;
      const reach = 0.20 + random() * 0.09;
      for (let fruit = 0; fruit < perStrand; fruit += 1) {
        const along = 0.10 + fruit / perStrand * 0.84;
        const distance = trunk.radius * 1.45 + reach * along;
        const ripeness = Math.min(1, 0.02 + bunch * 0.05 + strand * 0.03 +
          fruit / perStrand * 0.55 + random() * 0.12);
        context.model.fruit.push({
          color: getDateTone(ripeness, random),
          position: add(attach, [
            Math.cos(strandAngle) * distance + (random() - 0.5) * 0.035,
            -0.04 - along * (0.30 + random() * 0.06),
            Math.sin(strandAngle) * distance + (random() - 0.5) * 0.035
          ]),
          radius: archetype.fruit.radius * (0.82 + random() * 0.26)
        });
      }
    }
  }
};

/** Coconuts in clusters under the crown; date bunches hang further out between the fronds. */
const growFruit = (context: PalmContext, trunk: PalmTrunk) => {
  const { archetype, random, stage } = context;
  const { fruit } = archetype;
  if (archetype.dateBunches) { growDateBunches(context, trunk); return; }
  const count = Math.round(fruit.count * FRUIT_SHARE[stage]);
  for (let index = 0; index < count; index += 1) {
    const angle = (index / Math.max(1, count)) * Math.PI * 2 + random() * 0.6;
    const distance = trunk.radius * 1.25 + random() * 0.1;
    const unripe = random() < 0.35;
    context.model.fruit.push({
      color: unripe ? [0.22, 0.27, 0.1] : fruit.color,
      position: add(trunk.top, [
        Math.cos(angle) * distance,
        -0.12 - random() * 0.22,
        Math.sin(angle) * distance
      ]),
      radius: fruit.radius * (0.85 + random() * 0.3)
    });
  }
};

/** Per tree colour variant: mostly healthy green, some yellow-green (young, sunlit) or dark. */
const getFoliageTint = (base: Vec3, stage: GrowthStage, random: Random): Vec3 => {
  const roll = random();
  const yellow = stage <= 2 ? 0.45 : 0.15;
  if (roll < yellow) return [base[0] * 1.1, base[1] * 1.05, base[2] * 0.85];
  if (roll < yellow + 0.15) return [base[0] * 0.88, base[1] * 0.94, base[2] * 0.98];
  return base;
};

/**
 * Palm of a variant (form byte, tree-forms.ts PALM) at a growth stage: trunk, layered crown of
 * pinnate fronds or fan leaves, old leaf bases, fruit. Juveniles have their own structure.
 */
export const createPalmModel = (seed: number, stage: GrowthStage, form = 0): TreeModel => {
  const random = createRandom(seed);
  const archetype = getPalmArchetype(form);
  const model = createEmptyModel("palm", stage);
  model.look = {
    ...archetype.look,
    foliage: getFoliageTint(archetype.look.foliage, stage, random)
  };
  const context: PalmContext = {
    archetype,
    model,
    params: getPalmStage(archetype, stage),
    random,
    stage
  };
  const trunk = growTrunk(context);
  growCrown(context, trunk);
  growDeadSkirt(context, trunk);
  growLeafBases(context, trunk);
  growFruit(context, trunk);
  model.crownCentre = trunk.top;
  return finishModel(model);
};
