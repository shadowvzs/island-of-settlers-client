import type { Random } from "../../shared/world/rng";
import { normalize, type Vec3 } from "../props/mesh-builder";
import { add, fromAngles, scale } from "../props/tree-parts";
import type { Frond } from "./tree-model";

/** Points along a pinnate frond (petiole + rachis) and along a fan leaf's stalk. */
const PINNATE_POINTS = 13;
const FAN_POINTS = 5;
/** Extra downward pull on the last points of a frond with a bent (broken) tip. */
const BENT_TIP_PULL = 0.45;

/** Everything that shapes one frond (crown placement, age layer, variant look). */
export interface FrondPlan {
  age: number;
  azimuth: number;
  bentTip: boolean;
  blade: Frond["blade"];
  cell: number;
  droop: number;
  dry: number;
  /** Radians above the horizon where the frond leaves the crown. */
  elevation: number;
  fold: number;
  /** Downward pull per step (rachis arch: base rises, middle level, tip droops). */
  gravity: number;
  length: number;
  /** Bare petiole as a share of the length. */
  petiole: number;
  shade: number;
  /** Widest leaflet half span (fan: the fan radius), metres. */
  span: number;
  twist: number;
}

/**
 * Leaflet length along the leafy part of the rachis (0 first leaflet .. 1 tip): short at the
 * base and at the tip, longest a little before the middle (PALM_BRIEF.md leaflets).
 */
export const getLeafletLength = (along: number) => {
  const t = Math.min(1, Math.max(0, along));
  return 0.15 + 0.85 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.85);
};

/** The rachis (or fan stalk) as points: the pull grows towards the tip, so the tip droops. */
const growRachis = (attach: Vec3, plan: FrondPlan, count: number, length: number) => {
  let direction = fromAngles(plan.azimuth, plan.elevation);
  let position = attach;
  const step = length / (count - 1);
  const points: Vec3[] = [];
  for (let point = 0; point < count; point += 1) {
    points.push(position);
    const along = point / (count - 1);
    const bent = plan.bentTip && point >= count - 4 ? BENT_TIP_PULL : 0;
    const pull = plan.gravity * (0.15 + along * 1.7) + bent;
    direction = normalize(add(direction, [0, -pull, 0]));
    position = add(position, scale(direction, step));
  }
  return points;
};

/** Leaflet half span per point: none on the petiole, then the leaflet length profile. */
const getPinnateWidths = (plan: FrondPlan, leafletStart: number, random: Random) =>
  Array.from({ length: PINNATE_POINTS }, (_, point) => {
    if (point < leafletStart) return 0;
    const along = (point - leafletStart) / (PINNATE_POINTS - 1 - leafletStart);
    return plan.span * getLeafletLength(along) * (0.94 + random() * 0.12);
  });

const createFrond = (
  plan: FrondPlan,
  geometry: Pick<Frond, "leafletStart" | "points" | "widths">,
  random: Random
): Frond => ({
  ...geometry,
  age: plan.age,
  blade: plan.blade,
  cell: plan.cell,
  droop: plan.droop,
  dry: plan.dry,
  fold: plan.fold,
  phase: random(),
  roll: (random() - 0.5) * 0.5,
  shade: plan.shade,
  twist: plan.twist
});

/** Fan leaf: a stalk (petiole) ending in the fan's centre; the fan radius is the last width. */
const growFanLeaf = (attach: Vec3, plan: FrondPlan, random: Random) => {
  const points = growRachis(attach, plan, FAN_POINTS, plan.length * plan.petiole);
  const widths = points.map((_, index) => (index === FAN_POINTS - 1 ? plan.span : 0));
  return createFrond(plan, { leafletStart: FAN_POINTS - 1, points, widths }, random);
};

/** Pinnate frond: petiole -> rachis with leaflets whose length follows the profile. */
export const growFrond = (attach: Vec3, plan: FrondPlan, random: Random): Frond => {
  if (plan.blade === "fan") return growFanLeaf(attach, plan, random);
  const points = growRachis(attach, plan, PINNATE_POINTS, plan.length);
  const leafletStart = Math.max(1, Math.round(plan.petiole * (PINNATE_POINTS - 1)));
  const widths = getPinnateWidths(plan, leafletStart, random);
  return createFrond(plan, { leafletStart, points, widths }, random);
};

/** Straw brown multiplier of dead leaves over the green leaf texture. */
const DRY_TINT: Vec3 = [3.6, 1.7, 1.3];

/** A frond colour turned towards dead straw brown (dry 0 green .. 1 dead). */
export const tintDry = (color: Vec3, dry: number): Vec3 => [
  color[0] * (1 + (DRY_TINT[0] - 1) * dry),
  color[1] * (1 + (DRY_TINT[1] - 1) * dry),
  color[2] * (1 + (DRY_TINT[2] - 1) * dry)
];
