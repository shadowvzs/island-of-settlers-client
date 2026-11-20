import { WHEAT_BATCH_SIZE, WHEAT_FIELD_LIMIT } from "../balance/economy";
import { DMath } from "../math/deterministic-math";
import type { FieldWork } from "./settlement-field-cycles";
import type { ResourceTarget, SettlementBuilding, SettlementPoint } from "./settlement-types";

export const WHEAT_SOW_SECONDS = 3.6;

/** Prefer eight neighbouring plots, then use reachable scattered or partial batches when space is tight. */
export const planWheatBatch = (
  candidates: ResourceTarget[],
  building: SettlementBuilding,
  growing: number,
  pathFor: (target: ResourceTarget) => SettlementPoint[] | null
): FieldWork | null => {
  const maximum = Math.min(WHEAT_BATCH_SIZE, WHEAT_FIELD_LIMIT - growing);
  if (maximum <= 0) return null;
  candidates.sort((a, b) => DMath.hypot(a.x - building.access.x, a.z - building.access.z) -
    DMath.hypot(b.x - building.access.x, b.z - building.access.z) || a.id - b.id);
  const reachable = new Map<number, SettlementPoint[] | null>();
  const path = (target: ResourceTarget) => {
    if (!reachable.has(target.id)) reachable.set(target.id, pathFor(target));
    return reachable.get(target.id)!;
  };
  let fallback: ResourceTarget[] = [];
  for (const seed of candidates) {
    if (!path(seed)) continue;
    const selected = [seed];
    const neighbours = candidates.filter(target => DMath.hypot(target.x - seed.x, target.z - seed.z) <= 5);
    while (selected.length < maximum) {
      const last = selected[selected.length - 1]!;
      neighbours.sort((a, b) => DMath.hypot(a.x - last.x, a.z - last.z) -
        DMath.hypot(b.x - last.x, b.z - last.z) || a.id - b.id);
      const next = neighbours.find(target => selected.every(site =>
        DMath.hypot(target.x - site.x, target.z - site.z) >= 1.7) &&
        selected.some(site => DMath.hypot(target.x - site.x, target.z - site.z) <= 2.9) && path(target));
      if (!next) break;
      selected.push(next);
    }
    if (selected.length === maximum)
      return { stage: "sow", target: seed, path: path(seed)!, inputs: [], batch: selected.slice(1) };
    if (selected.length > fallback.length) fallback = selected;
  }
  for (const candidate of candidates) {
    if (fallback.length >= maximum) break;
    if (fallback.every(site => DMath.hypot(candidate.x - site.x, candidate.z - site.z) >= 1.7) &&
      path(candidate)) fallback.push(candidate);
  }
  const seed = fallback[0];
  return seed ? { stage: "sow", target: seed, path: path(seed)!, inputs: [], batch: fallback.slice(1) } : null;
};
