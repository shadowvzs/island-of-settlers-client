import { isFiniteNumber, isSaveInteger, isSaveObject, isSavePoint } from "./save-validation";

const validWait = (wait: unknown, clock: number) => isSaveObject(wait) && isFiniteNumber(wait.since) &&
  wait.since >= 0 && wait.since <= clock;
const validWatch = (value: unknown) => {
  if (value === undefined) return true;
  return isSaveObject(value) && isFiniteNumber(value.elapsed) && value.elapsed >= 0 &&
    isSavePoint(value.point) && (value.goal === undefined || isSavePoint(value.goal)) && typeof value.yielded === "boolean";
};

/** Validate optional current admission receipts before touching any live actor or court. */
export const validateStockTraffic = (value: unknown, actors: unknown, buildings: unknown): string | null => {
  if (value === undefined) return null;
  const problem = "Invalid stock-court traffic receipts";
  if (!isSaveObject(value) || !isFiniteNumber(value.clock) || value.clock < 0 ||
    !Array.isArray(value.owners) || !Array.isArray(value.actors) || !Array.isArray(actors) || !Array.isArray(buildings)) return problem;
  const actorIds = new Map(actors.filter(isSaveObject).map(actor => [actor.uid, actor]));
  const sites = new Map(buildings.filter(isSaveObject).map(site => [site.uid, site]));
  const owners = new Set<number>(), queued = new Set<number>();
  for (const entry of value.owners) {
    if (!isSaveObject(entry) || !isSaveInteger(entry.building) || !isSaveInteger(entry.actor) || owners.has(entry.building)) return problem;
    const actor = actorIds.get(entry.actor), site = sites.get(entry.building);
    if (!actor || !site) return problem;
    owners.add(entry.building);
    if (!validWatch(entry.watch)) return problem;
  }
  for (const entry of value.actors) {
    if (!isSaveObject(entry) || !isSaveInteger(entry.actor) || queued.has(entry.actor)) return problem;
    const actor = actorIds.get(entry.actor);
    if (!actor || entry.phase !== actor.phase || entry.cooldown !== undefined && (!isFiniteNumber(entry.cooldown) || entry.cooldown < 0)) return problem;
    queued.add(entry.actor);
    if (entry.queued !== undefined) {
      const wait = entry.queued;
      if (!isSaveObject(wait) || !sites.has(wait.building) || !["inputApproach", "outputWalk", "deliveryStockWalk", "pickupStockWalk"].includes(wait.phase as string) || !validWait(wait, value.clock)) return problem;
    }
    if (entry.entry !== undefined) {
      const wait = entry.entry;
      if (!isSaveObject(wait) || !actorIds.has(wait.rival) || wait.rival === entry.actor ||
        !validWait(wait, value.clock)) return problem;
    }
  }
  return null;
};
