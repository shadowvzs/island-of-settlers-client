import { ARROW_GRAVITY, type MilitaryArrow } from "../../shared/settlement/military-projectiles";
import type { SettlementActor } from "../../shared/settlement/settlement-types";

/** Draw the same timed arrow that triggers the hunting hit, using the shared combat effect batch. */
export const huntingArrows = (actors: readonly SettlementActor[]): MilitaryArrow[] => actors.flatMap(actor => {
  const shot = actor.huntArrow;
  if (!shot || actor.phase !== "huntFlight") return [];
  const age = Math.max(0, shot.duration - actor.timer);
  const vx = (shot.target.x - shot.origin.x) / shot.duration;
  const vz = (shot.target.z - shot.origin.z) / shot.duration;
  const initialVy = (shot.target.y - shot.origin.y + .5 * ARROW_GRAVITY * shot.duration ** 2) / shot.duration;
  return [{ id: -actor.uid - 1, shooter: actor.uid, faction: 0, rank: 0, age,
    x: shot.origin.x + vx * age, y: shot.origin.y + initialVy * age - .5 * ARROW_GRAVITY * age ** 2,
    z: shot.origin.z + vz * age, vx, vy: initialVy - ARROW_GRAVITY * age, vz }];
});
