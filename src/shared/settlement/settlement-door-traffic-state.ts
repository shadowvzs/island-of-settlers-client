import type { SavedStorageDeparture } from "./settlement-door-departures";
import type { SavedReservationWatch } from "./settlement-reservation-watchdog";
import type { SettlementPoint } from "./settlement-types";

export interface SavedStorageActor {
  actor: number; phase: string; home: number; identityKnown: boolean; identityCurrent: boolean; staged: boolean;
  waiting?: SettlementPoint; parkingPath?: SettlementPoint[];
  registeredAt?: number; deferred?: number; deferredRetries?: number;
  failedEntries?: number; retries?: number; queueCursor?: number;
}
export interface SavedStorageTraffic {
  clock: number; parkingBudget: number; arrivalSerial: number; watchOrder: string[];
  owners: { building: number; actor: number; identityCurrent: boolean; watch?: SavedReservationWatch }[];
  actors: SavedStorageActor[];
  departures: SavedStorageDeparture[];
}
