import type { MilitaryTroopType } from "../../shared/settlement/military-combat-rules";
import { troopTypes } from "../settlement/army-action-rail";
import { troopName } from "../settlement/troop-names";
import type { SettlementShipSummary } from "./types";

export interface ShipPassengerRow {
  count: number;
  label: string;
  /** Troop type for a military unit icon; absent for civilians (generic settlers icon). */
  troop?: MilitaryTroopType;
}

/** Soldiers are listed per troop type, so the job list keeps only those without one. */
const civilianRows = (ship: SettlementShipSummary): ShipPassengerRow[] => {
  const typed = Object.values(ship.troops ?? {}).reduce((sum, count) => sum + count, 0);
  return Object.entries(ship.passengers ?? {})
    .map(([job, count]) => ({ count: job === "Soldier" ? count - typed : count, label: job }))
    .filter(row => row.count > 0);
};

const troopRows = (ship: SettlementShipSummary, nation: string): ShipPassengerRow[] => troopTypes
  .map(troop => ({ count: ship.troops?.[troop] ?? 0, label: troopName(nation, troop), troop }))
  .filter(row => row.count > 0);

/** Register rows: soldiers by troop type first, then civilians by job. */
export const shipPassengerRows = (
  ship: SettlementShipSummary, nation: string
): ShipPassengerRow[] => [...troopRows(ship, nation), ...civilianRows(ship)];
