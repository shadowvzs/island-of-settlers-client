import { STORAGE_IDS } from "./production-rules";
import { isFiniteNumber, isSaveInteger, isSaveObject, isSavePoint } from "./save-validation";

const validWatch = (value: unknown) => value === undefined || isSaveObject(value) &&
  isFiniteNumber(value.elapsed) && value.elapsed >= 0 && isSavePoint(value.point) &&
  (value.goal === undefined || isSavePoint(value.goal)) && typeof value.yielded === "boolean";
const validActor = (entry: Record<string, unknown>, actor: Record<string, unknown>, clock: number) => {
  if (entry.phase !== actor.phase || entry.home !== actor.home || typeof entry.identityCurrent !== "boolean" ||
    typeof entry.identityKnown !== "boolean" || entry.identityCurrent && !entry.identityKnown || typeof entry.staged !== "boolean" || entry.waiting !== undefined && !isSavePoint(entry.waiting) ||
    entry.parkingPath !== undefined && (!Array.isArray(entry.parkingPath) || !entry.parkingPath.every(isSavePoint))) return false;
  for (const key of ["registeredAt", "deferred", "deferredRetries"])
    if (entry[key] !== undefined && (!isFiniteNumber(entry[key]) || entry[key] < 0)) return false;
  if (isFiniteNumber(entry.registeredAt) && entry.registeredAt > clock) return false;
  for (const key of ["failedEntries", "retries", "queueCursor"])
    if (entry[key] !== undefined && !isSaveInteger(entry[key])) return false;
  return true;
};
const validDeparture = (entry: Record<string, unknown>, actor: Record<string, unknown> | undefined, clock: number) =>
  !!actor && actor.visible === false && actor.phase === entry.phase && actor.home === entry.home &&
  isFiniteNumber(entry.since) && entry.since >= 0 && entry.since <= clock;
const validClock = (value: Record<string, unknown>) => isFiniteNumber(value.clock) && value.clock >= 0 &&
  isFiniteNumber(value.parkingBudget) && value.parkingBudget >= 0 && value.parkingBudget <= 4 && isSaveInteger(value.arrivalSerial);
/** Optional historical absence keeps existing initialization; present receipts must be complete. */
export const validateStorageTraffic = (value: unknown, actors: unknown, buildings: unknown): string | null => {
  if (value === undefined) return null;
  const problem = "Invalid storage-door traffic receipts";
  if (!isSaveObject(value) || !validClock(value) || !Array.isArray(value.watchOrder) ||
    !Array.isArray(value.owners) || !Array.isArray(value.actors) || !Array.isArray(value.departures) ||
    !Array.isArray(actors) || !Array.isArray(buildings)) return problem;
  const people = new Map(actors.filter(isSaveObject).map(actor => [actor.uid, actor]));
  const sites = new Map(buildings.filter(isSaveObject).map(site => [site.uid, site]));
  const validStorage = (id: unknown) => { const site = sites.get(id); return !!site && STORAGE_IDS.has(site.typeId as number); };
  const owned = new Set<number>(), queued = new Set<number>(), departing = new Set<number>();
  for (const entry of value.owners) {
    if (!isSaveObject(entry) || !isSaveInteger(entry.building) || !isSaveInteger(entry.actor) ||
      !validStorage(entry.building) || !people.has(entry.actor) || owned.has(entry.building) ||
      typeof entry.identityCurrent !== "boolean" || !validWatch(entry.watch)) return problem;
    owned.add(entry.building);
  }
  for (const entry of value.actors) {
    if (!isSaveObject(entry) || !isSaveInteger(entry.actor) || queued.has(entry.actor)) return problem;
    const actor = people.get(entry.actor);
    if (!actor || !validActor(entry, actor, value.clock as number)) return problem;
    queued.add(entry.actor);
  }
  for (const entry of value.departures) {
    if (!isSaveObject(entry) || !isSaveInteger(entry.actor) || departing.has(entry.actor) ||
      !isSaveInteger(entry.building) || !validStorage(entry.building)) return problem;
    const actor = people.get(entry.actor);
    if (!validDeparture(entry, actor, value.clock as number)) return problem;
    departing.add(entry.actor);
  }
  const order = new Set<string>();
  for (const key of value.watchOrder) {
    if (typeof key !== "string" || !/^(court|door):\d+$/.test(key) || order.has(key) || !sites.has(Number(key.split(":")[1]))) return problem;
    order.add(key);
  }
  return null;
};
