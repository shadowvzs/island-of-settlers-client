import { DMath } from "../math/deterministic-math";
import { markFogChanged } from "../world/fog-revision";
import { FOG } from "../world/world-data";
import type { NavalShip } from "./settlement-naval-fleet";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * Real scout sight only: moving ships reveal 15.6 tiles, coastal observation stops 26 (30% above their original radii).
 * Charting is a separate consumer of the resulting authoritative fog; presentation overrides and
 * temporary possessed sight never write to it.
 */
export const createNavalExploration = (context: SettlementContext) => {
  const { world } = context.options;
  const last = new Map<number, SettlementPoint & { radius: number }>();
  const discover = (ships: readonly NavalShip[], onObserved?: (x: number, z: number, radius: number) => void) => {
    if (!world.fog) return;
    for (const ship of ships) {
      if (!ship.exploration || !ship.passengers?.length ||
        ["idle", "loading", "away", "founding", "dismantling"].includes(ship.phase)) {
        last.delete(ship.id);
        continue;
      }
      const before = last.get(ship.id), radius = ship.phase === "unloading" && !ship.exploration.returning ? 26 : 15.6;
      if (before && DMath.hypot(before.x - ship.x, before.z - ship.z) < .5 && before.radius === radius) continue;
      last.set(ship.id, { x: ship.x, z: ship.z, radius });
      let changed = false;
      for (let z = Math.max(0, Math.floor(ship.z - radius)); z < Math.min(world.cellsZ, Math.ceil(ship.z + radius)); z++)
        for (let x = Math.max(0, Math.floor(ship.x - radius)); x < Math.min(world.cellsX, Math.ceil(ship.x + radius)); x++) {
          const index = z * world.cellsX + x;
          if ((x + .5 - ship.x) * (x + .5 - ship.x) +
            (z + .5 - ship.z) * (z + .5 - ship.z) <= radius * radius && world.fog[index] === FOG.hidden) {
            world.fog[index] = FOG.discovered;
            changed = true;
          }
        }
      if (!changed) continue;
      markFogChanged(world, true);
      onObserved?.(ship.x, ship.z, radius);
    }
  };
  return { discover };
};
