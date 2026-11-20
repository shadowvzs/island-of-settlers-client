import { DMath } from "../math/deterministic-math";
import type { MineZone } from "../world/world-data";
import { isScoutFogTarget } from "./scout-exploration";
import { PLAYER_FACTION } from "./settlement-ownership";
import { groundPath } from "./settlement-paths";
import type { SettlementContext, SettlementPoint } from "./settlement-types";
export type SurveyJob = "Geologist" | "Scout";
export interface SurveyTarget extends SettlementPoint {
  zoneId?: number;
}
/**
 * Whether `owner` already knows the deposit: the player's survey is the map's signpost (`zone.surveyed`); a computer
 * faction's is its AI's own record (EAI3c), so neither side learns from the other's geologists.
 */
export const isZoneSurveyed = (context: SettlementContext, zone: Readonly<MineZone>, owner: number) => {
  if (owner === PLAYER_FACTION) return zone.surveyed;
  return context.factionAi?.knowsDeposit(owner, zone.id) === true;
};

/** Deterministic reachable surveying points of `owner`'s geologist; no hidden ore is consumed by exploration. */
export const surveyTargets = (
  context: SettlementContext,
  job: SurveyJob,
  near: SettlementPoint,
  owner = PLAYER_FACTION
): SurveyTarget[] => {
  const { world } = context.options;
  if (job === "Scout") return isScoutFogTarget(world, near) ? [{ ...near }] : [];
  const candidates: SurveyTarget[] = [];
  if (job === "Geologist") {
    for (
      let z = Math.max(0, Math.floor(near.z) - 6);
      z <= Math.min(world.cellsZ - 1, near.z + 6);
      z++
    )
      for (
        let x = Math.max(0, Math.floor(near.x) - 6);
        x <= Math.min(world.cellsX - 1, near.x + 6);
        x++
      ) {
        const cell = z * world.cellsX + x,
          zoneId = world.mineZone[cell]!;
        if (!world.mineZones.some(zone => zone.id === zoneId && !isZoneSurveyed(context, zone, owner))) continue;
        candidates.push({ x: x + 0.5, z: z + 0.5, zoneId });
      }
  }
  candidates.sort(
    (a, b) =>
      DMath.hypot(a.x - near.x, a.z - near.z) - DMath.hypot(b.x - near.x, b.z - near.z) ||
      a.z - b.z ||
      a.x - b.x
  );
  const selected: SurveyTarget[] = [],
    seen = new Set<number>();
  for (const point of candidates) {
    if (point.zoneId && seen.has(point.zoneId)) continue;
    if (!groundPath(context, near, point)) continue;
    selected.push(point);
    if (point.zoneId) seen.add(point.zoneId);
    if (selected.length === 8) break;
  }
  return selected;
};
