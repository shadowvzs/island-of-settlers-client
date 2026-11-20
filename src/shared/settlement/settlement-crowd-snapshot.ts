import { DMath } from "../math/deterministic-math";
import { actorSeparation, isTrafficPassThrough } from "./settlement-traffic";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

const CELL_STRIDE = 65_536;
/** Widens the cell range against hypot rounding; a body this far out is far outside its limit. */
const REACH_MARGIN = 1e-6;

interface CrowdBody { limit: number; x: number; z: number }

/** Visible bodies `actor` must keep clear of, with their clearance plus `margin`, bucketed by `reach`. */
const snapshotCrowd = (context: SettlementContext, actor: SettlementActor, margin: number) => {
  const bodies: CrowdBody[] = [];
  let reach = 0;
  for (const other of context.actors) {
    if (other === actor || !other.visible || isTrafficPassThrough(context, actor, other)) continue;
    const limit = actorSeparation(actor, other) + margin;
    bodies.push({ limit, x: other.x, z: other.z });
    reach = Math.max(reach, limit);
  }
  const cell = Math.max(reach, 1e-3);
  const buckets = new Map<number, CrowdBody[]>();
  for (const body of bodies) {
    const key = Math.floor(body.z / cell) * CELL_STRIDE + Math.floor(body.x / cell);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(body); else buckets.set(key, [body]);
  }
  return { buckets, cell, reach };
};

/**
 * A10: "is `point` inside another body's clearance" for one ground search. The search runs
 * synchronously and moves nobody, so the crowd is read once (on the first sample) instead of
 * scanning every actor, with the pass-through rules, for every sampled point. Same answer as
 * `context.actors.some(other => other !== actor && other.visible && !isTrafficPassThrough(...) &&
 * hypot(other - point) < actorSeparation(actor, other) + margin)`: a body farther than the largest
 * limit on either axis cannot be inside its own limit, so only neighbouring cells are read.
 */
export const createCrowdPointBlocker = (context: SettlementContext, actor: SettlementActor, margin: number) => {
  let crowd: ReturnType<typeof snapshotCrowd> | undefined;
  return (point: SettlementPoint) => {
    crowd ??= snapshotCrowd(context, actor, margin);
    const { buckets, cell } = crowd;
    const reach = crowd.reach + REACH_MARGIN;
    for (let z = Math.floor((point.z - reach) / cell); z <= Math.floor((point.z + reach) / cell); z++)
      for (let x = Math.floor((point.x - reach) / cell); x <= Math.floor((point.x + reach) / cell); x++)
        for (const body of buckets.get(z * CELL_STRIDE + x) ?? [])
          if (DMath.hypot(body.x - point.x, body.z - point.z) < body.limit) return true;
    return false;
  };
};
