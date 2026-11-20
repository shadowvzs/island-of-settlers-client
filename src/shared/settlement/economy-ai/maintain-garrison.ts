import type { SettlementContext } from "../settlement-types";
import { SOLDIERS_PER_GARRISON_DECISION } from "./constants";
import { isOwnGarrison } from "./develop-garrison";

/**
 * Re-garrison from the reserve (plan §4.1 `maintain`): the faction's finished garrison buildings below their
 * target each take stored soldiers of its own depot, in building order, at most `SOLDIERS_PER_GARRISON_DECISION`
 * per decision. Only soldiers inside storages walk out, so no soldier an A14 force holds is ever taken (A14-4c
 * `uncommitted`). Returns how many soldiers were sent.
 */
export const regarrisonFromReserve = (context: Pick<SettlementContext, "buildings" | "military">, faction: number) => {
  const garrison = context.military?.garrisonFromReserve;
  if (!garrison) return 0;
  let sent = 0;
  for (const building of context.buildings) {
    if (!isOwnGarrison(building, faction)) continue;
    while (sent < SOLDIERS_PER_GARRISON_DECISION && garrison(building.uid)) sent++;
    if (sent >= SOLDIERS_PER_GARRISON_DECISION) break;
  }
  return sent;
};
