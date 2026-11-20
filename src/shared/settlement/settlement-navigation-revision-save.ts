import { isSaveInteger, isSaveObject } from "./save-validation";

/** Logical epochs and inherited aliases are optional historically, but present identities must be valid. */
export const validateNavigationRevisions = (value: unknown, actors: unknown): string | null => {
  if (value === undefined) return null;
  if (!isSaveObject(value) || !isSaveInteger(value.build) || !isSaveInteger(value.roads))
    return "Invalid navigation revision counters";
  if (value.aliases === undefined) return null;
  if (!Array.isArray(value.aliases) || !Array.isArray(actors)) return "Invalid navigation revision aliases";
  const people = new Set(actors.filter(isSaveObject).map(actor => actor.uid)), seen = new Set<number>();
  for (const entry of value.aliases) {
    if (!isSaveObject(entry) || !isSaveInteger(entry.actor) || !people.has(entry.actor) || seen.has(entry.actor) ||
      typeof entry.saved !== "string" || typeof entry.actual !== "string") return "Invalid navigation revision aliases";
    seen.add(entry.actor);
  }
  return null;
};
