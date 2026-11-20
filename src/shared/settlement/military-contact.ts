import { DMath } from "../math/deterministic-math";
import type { MilitaryTroopType } from "./military-combat-rules";
import { RIDER_FOOT_SEPARATION } from "./settlement-traffic";
import type { SettlementPoint } from "./settlement-types";

/** Measured mounted model half-bounds, including its forward origin offset and a small pad. */
export const militaryContactReach = (
  attacker: MilitaryTroopType, range: number, source: SettlementPoint & { mounted?: boolean },
  defender: MilitaryTroopType, target: SettlementPoint & { mounted?: boolean; yaw: number }
) => {
  if (attacker === "archer") return range;
  // A short catalogue axe must be able to touch a foot foe while respecting the horse's hard body clearance.
  const contactRange = source.mounted && !target.mounted ? Math.max(range, RIDER_FOOT_SEPARATION + .04) : range;
  if (defender !== "cavalry" || !target.mounted) return contactRange;
  const dx = source.x - target.x, dz = source.z - target.z;
  const distance = DMath.hypot(dx, dz) || 1;
  const forward = (dx * DMath.sin(target.yaw) + dz * DMath.cos(target.yaw)) / distance;
  const side = (dx * DMath.cos(target.yaw) - dz * DMath.sin(target.yaw)) / distance;
  const support = .83 * Math.abs(forward) + .313 * Math.abs(side) + .052 * forward + .05;
  return contactRange + support;
};
