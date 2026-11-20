import { COLONY_LIFETIME_MS } from "@shared/catalog/balance";

import { talentModifiers } from "../../shared/progression/talents";
import { colonyOreShipMs } from "../../shared/settlement/archipelago";
import { type ArchivedColonyCursor, archivedIslandProof, archivedIslandProofProblem } from "../../shared/settlement/archived-relief-journal";
import type { GameSaveV1 } from "../../shared/settlement/game-save";

export const ARCHIVED_RELIEF_EXTERNAL_CUSTODY = "Visit the collection island to finish its other voyages before collecting aid";

/** Cross-island receipts belong to the live archipelago bridge, never an unconnected private simulation. */
export const archivedReliefCustodyBlocker = (save: GameSaveV1): string | undefined => {
  const naval = save.settlement.naval;
  const foreignShip = naval.fleet.ships.some(ship => ship.colony || ship.visitor && !ship.visitor.relief);
  const foreignOrder = naval.fleet.orders.some(order => order.colony);
  const foreignPreparation = naval.colonies.expeditions.some(expedition => expedition.status !== "arrived");
  // A queued market delivery may create a foreign visitor during the first native tick.
  const marketDelivery = Boolean(save.settlement.trade && (save.settlement.trade.deliveries.length ||
    save.settlement.trade.offers.length || save.settlement.trade.escrow.length));
  return foreignShip || foreignOrder || foreignPreparation || marketDelivery ? ARCHIVED_RELIEF_EXTERNAL_CUSTODY : undefined;
};

/** Used before donor selection, before payment, and before every later native chunk. */
export const archivedReliefSourceBlocker = (save: GameSaveV1, cursor?: ArchivedColonyCursor, paymentClock?: number): string | undefined => {
  const malformed = archivedIslandProofProblem(save), custody = archivedReliefCustodyBlocker(save);
  if (malformed || custody) return malformed ?? custody;
  if (cursor?.conqueredAt !== undefined && (paymentClock ?? save.savedAt) >= cursor.conqueredAt + COLONY_LIFETIME_MS)
    return "This colony has expired and cannot accept a new aid payment";
  if (cursor?.beforeNextOreShipAt !== undefined && cursor.beforeNextOreShipAt < save.savedAt && !cursor.beforeNativeEconomy?.coverage.some(span =>
    span[0] <= cursor.beforeNextOreShipAt! && span[1] >= save.savedAt))
    return "An overdue legacy colony shipment needs reconciliation before native relief";
  const proof = archivedIslandProof(save), first = proof?.contexts?.[0]?.colonyCursor ?? cursor;
  const initialTalents = proof?.contexts?.[0]?.player.talents ?? save.player?.talents;
  const interval = colonyOreShipMs(talentModifiers(initialTalents).colonyShipIntervalReduction);
  const initialDue = first?.conqueredAt === undefined ? undefined : first.conqueredAt + interval;
  if (first?.beforeNextOreShipAt !== undefined && first.beforeNextOreShipAt !== initialDue &&
    first.beforeNextOreShipAt - interval > (proof?.coverage.from ?? save.savedAt))
    return "The filed colony has unjournalled historical shipments; a verified handover is required";
  return undefined;
};
