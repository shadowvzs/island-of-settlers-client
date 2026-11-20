/**
 * A person a voyage was counting on is lost on land (MIL-CREWS: killed or fled from raiders): every
 * voyage list drops them, the ship is not touched. A preparation or colony expedition gathers a new
 * helper; a queued order or loading ship sails with the people left. An exploration voyage that lost
 * its only scout is cancelled instead of sailing blind (MIL-TWEAKS, owner 2026-11-09); the lost
 * scout's spyglass goes back to its harbour (military-civilian-crews.ts).
 */
export interface NavalPersonHolder {
  /** On a ship: its cargo count includes the passengers. */
  cargoCount?: number;
  crew?: number[];
  passengers?: number[];
}

/** Removes `uid` from one holder's crew and passenger lists; true when it was there. */
export const dropNavalPerson = (holder: NavalPersonHolder, uid: number) => {
  let dropped = false;
  const crew = holder.crew?.indexOf(uid) ?? -1;
  if (crew >= 0) { holder.crew!.splice(crew, 1); dropped = true; }
  const passenger = holder.passengers?.indexOf(uid) ?? -1;
  if (passenger >= 0) {
    holder.passengers!.splice(passenger, 1);
    if (holder.cargoCount !== undefined) holder.cargoCount--;
    dropped = true;
  }
  return dropped;
};

/** The saved naval lists that may name a person (for the offline estimate, which edits a save). */
export interface SavedNavalPeople {
  active: [number, unknown][];
  colonies?: { expeditions: NavalPersonHolder[] };
  fleet: { orders: NavalPersonHolder[]; ships: NavalPersonHolder[] };
  preparation?: { preparations: NavalPersonHolder[] };
}

/** The save-side twin of the live naval release: every list forgets `uid`, a shipwright its ship site. */
export const forgetSavedNavalPerson = (naval: SavedNavalPeople, uid: number) => {
  for (const holder of [...naval.fleet.orders, ...naval.fleet.ships, ...naval.preparation?.preparations ?? [],
    ...naval.colonies?.expeditions ?? []]) dropNavalPerson(holder, uid);
  naval.active = naval.active.filter(([actor]) => actor !== uid);
};

/** An exploration voyage, queued or on its ship, still outbound with no scout left. */
interface ExplorationHolder extends NavalPersonHolder {
  cancelled?: boolean;
  exploration?: { returning: boolean };
}

const isScoutless = (holder: ExplorationHolder) =>
  holder.exploration !== undefined && !holder.exploration.returning && !holder.cancelled &&
  !holder.passengers?.length;

/** The fleet calls the scout check needs: its live lists and the ordinary cancel/recall. */
export interface ScoutlessFleet {
  cancelTransport: (id: number) => boolean;
  saveState: () => {
    orders: (ExplorationHolder & { id: number })[];
    ships: (ExplorationHolder & { orderId?: number })[];
  };
}

/**
 * Cancels every exploration voyage that lost its scout: a queued order is dropped, a ship already
 * fetching it is recalled to its harbour (both through the fleet's ordinary cancel, deterministic).
 */
export const cancelScoutlessExplorations = (fleet: ScoutlessFleet) => {
  const { orders, ships } = fleet.saveState();
  const ids = [...orders.filter(isScoutless).map(order => order.id),
    ...ships.filter(isScoutless).flatMap(ship => ship.orderId === undefined ? [] : [ship.orderId])];
  for (const id of ids) fleet.cancelTransport(id);
};
