import type { NavalShip } from "./settlement-naval-fleet";
import { shipArrivalEstimate } from "./ship-arrival-estimate";
import { shipTravelSeconds } from "./ship-travel-time";

/** Names only identify locations present in the simulation; no guessed island identity or idle ETA. */
export const shipRegisterJourney = (ship: NavalShip) => {
  const harbour = (uid?: number) => uid === undefined ? "Local waters" : `Harbour ${uid}`;
  const colony = ship.colony;
  if (colony && ship.phase === "away") {
    const outbound = !colony.arrived && ship.timer > colony.voyageSeconds;
    const remote = `Expedition ${colony.expeditionId}`;
    return {
      origin: outbound ? harbour(ship.sourceUid) : remote,
      destination: outbound ? remote : harbour(ship.sourceUid),
      leg: outbound ? "Outbound voyage" : "Return voyage",
      legSeconds: Math.ceil(shipTravelSeconds(Math.max(0,
        ship.timer - (outbound ? colony.voyageSeconds : 0))))
    };
  }
  const remote = ship.visitor?.sourceColony === undefined
    ? "Another island" : `Expedition ${ship.visitor.sourceColony}`;
  let origin = harbour(ship.sourceUid);
  if (ship.visitor) origin = ship.visitor.leaving ? harbour(ship.destinationUid) : remote;
  let destination = harbour(ship.destinationUid);
  if (ship.visitor?.leaving) destination = remote;
  else if (colony) destination = `Expedition ${colony.expeditionId}`;
  else if (ship.expedition) destination = "Settlement site";
  else if (ship.foundingSiteUid !== undefined) destination = "Founding harbour";
  else if (ship.exploration && !ship.exploration.returning) destination = "Exploration waypoint";
  let leg = "Sailing";
  if (ship.phase === "idle") leg = "Idle";
  else if (ship.phase === "founding") leg = "Founding harbour";
  // A ship lying at its waiting spot is "stranded" with `queuedAt` while it waits for the berth (pier queue).
  else if (ship.queuedAt && !ship.terrainBlocked) leg = "Waiting for harbour";
  else if (ship.phase === "stranded") leg = "Route blocked";
  else if (ship.phase === "loading") leg = "Loading / boarding";
  else if (ship.phase === "unloading") leg = "Unloading";
  else if (ship.phase === "positioning") leg = "Positioning";
  const waitingForEntry = ship.phase === "away" && ship.timer <= 0;
  if (waitingForEntry) leg = "Waiting for entry";
  const moving = ["away", "sailing", "positioning"].includes(ship.phase) && !waitingForEntry;
  const legSeconds = moving && !ship.queuedAt ? shipArrivalEstimate(ship) : undefined;
  return { origin, destination, leg, legSeconds };
};
