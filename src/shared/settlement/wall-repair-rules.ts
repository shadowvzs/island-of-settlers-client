import { WALL_REPAIR_TRIP_SHARE } from "../balance/military";
import type { MilitaryStructure } from "./fort-assault-rules";
import type { Goods } from "./settlement-types";

/** One repair trip (EAI2d): the wares it carries and the wall HP they pay for. */
export interface WallRepairLoad {
  goods: Goods;
  hp: number;
}

type Walls = Readonly<Pick<MilitaryStructure, "hp" | "maximum">>;

/** Whether the walls stand and miss hit points. */
export const needsWallRepair = (walls: Walls | undefined): walls is Walls =>
  walls !== undefined && walls.hp > 0 && walls.hp < walls.maximum;

/** The HP one trip restores: the missing HP rounded up, at most `WALL_REPAIR_TRIP_SHARE` of the walls. */
const tripHp = ({ hp, maximum }: Walls) =>
  Math.min(Math.ceil(maximum - hp), Math.ceil(maximum * WALL_REPAIR_TRIP_SHARE));

/**
 * The load of one trip: the restored HP's share of the construction cost, rounded down per ware (wares a–z). A
 * share that rounds to nothing still takes one unit of the costliest ware (ties a–z), so a repair is never free
 * (owner 2026-11-13: maintain repairs only from authored stock). Undefined without a cost or without damage.
 */
export const wallRepairLoad = (cost: Readonly<Goods>, walls: Walls | undefined): WallRepairLoad | undefined => {
  if (!needsWallRepair(walls)) return undefined;
  const hp = tripHp(walls), goods: Goods = {};
  let costliest: string | undefined;
  for (const ware of Object.keys(cost).sort()) {
    const count = cost[ware] ?? 0;
    if (count <= 0) continue;
    if (costliest === undefined || count > cost[costliest]!) costliest = ware;
    const share = Math.floor(count * hp / walls.maximum);
    if (share > 0) goods[ware] = share;
  }
  if (costliest === undefined) return undefined;
  if (!Object.keys(goods).length) goods[costliest] = 1;
  return { goods, hp };
};

/** Standing walls regain `amount` HP, never above their maximum; returns the HP gained. */
export const repairStructure = (walls: MilitaryStructure | undefined, amount: number) => {
  if (!walls || walls.hp <= 0 || !(amount > 0)) return 0;
  const before = walls.hp;
  walls.hp = Math.min(walls.maximum, before + amount);
  return walls.hp - before;
};
