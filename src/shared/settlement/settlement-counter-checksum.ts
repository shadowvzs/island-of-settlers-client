import { pendingStoneRespawns } from "./boulder-respawn";
import type { createSettlementMilitary } from "./settlement-military";
import { hashNumbers } from "./settlement-state-hash";
import type { SettlementContext } from "./settlement-types";

/**
 * Counter checksum (D4.2): the island tick, every seeded stream's state and draw count, entity counts,
 * the next ids and the pending timers. A few dozen integers, so it runs every tick; the first log entry whose
 * checksum differs locates a divergence to its tick without hashing the whole state.
 */
export const counterChecksumValues = (
  context: SettlementContext, military: Pick<ReturnType<typeof createSettlementMilitary>, "counters">
): number[] => {
  const audit = context.randomAudit;
  const [soldiers, militaryTimers] = military.counters();
  const values = [context.clock?.tick() ?? 0, context.actors.length, context.buildings.length, soldiers,
    context.nextActor, context.nextBuilding, context.transfers.length, militaryTimers, pendingStoneRespawns(context),
    audit?.drawCount() ?? 0];
  for (const [, state] of audit?.states() ?? []) values.push(state);
  return values;
};

export const counterChecksum = (...args: Parameters<typeof counterChecksumValues>) =>
  hashNumbers(counterChecksumValues(...args));
