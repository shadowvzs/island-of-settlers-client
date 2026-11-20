import { bridgeDecks } from "./bridge-deck";
import type { BridgeRemoval } from "./bridge-dismantling";
import { bridgeLatticeSpan } from "./bridge-lattice";
import { bridgeRoadProblem } from "./bridge-road";
import { isRoadTier, type RoadSegment } from "./road-types";
import { isFiniteNumber, isSaveInteger, isSaveObject, isSavePoint } from "./save-validation";

const REMOVAL_KEYS = new Set(["elapsed", "id", "phase", "progress", "segments"]);
const PHASES = new Set(["closing", "dismantling"]);

const segmentsProblem = (id: number, segments: unknown) => {
  if (!Array.isArray(segments) || !segments.length) return "Invalid bridge removal span";
  if (!segments.every(segment => isSaveObject(segment) && isSavePoint(segment.start) &&
    isSavePoint(segment.end) && isRoadTier(segment.tier) && isSaveObject(segment.bridge)))
    return "Invalid bridge removal segment";
  const typed = segments as RoadSegment[];
  const problem = bridgeRoadProblem(typed);
  if (problem) return problem;
  if (typed.some(segment => segment.bridge!.id !== id || segment.bridge!.closed !== undefined))
    return "Inconsistent bridge removal span";
  const ordered = [...typed].sort((a, b) => a.bridge!.tile - b.bridge!.tile);
  const span = bridgeLatticeSpan(ordered[0]!.start, ordered.at(-1)!.end);
  return span && span.edges === typed.length ? null : "Incomplete bridge removal span";
};

const entryProblem = (value: unknown) => {
  if (!isSaveObject(value) || Object.keys(value).some(key => !REMOVAL_KEYS.has(key)))
    return "Invalid bridge removal";
  if (!isSaveInteger(value.id) || !PHASES.has(String(value.phase))) return "Invalid bridge removal";
  if (!isFiniteNumber(value.elapsed) || value.elapsed < 0 || !isFiniteNumber(value.progress) ||
    value.progress < 0 || value.progress > 1) return "Invalid bridge removal timing";
  return segmentsProblem(value.id, value.segments);
};

const sameEnds = (removal: BridgeRemoval, roads: readonly RoadSegment[]) => {
  const deck = bridgeDecks(roads.filter(segment => segment.bridge?.id === removal.id))[0];
  const ordered = [...removal.segments].sort((a, b) => a.bridge!.tile - b.bridge!.tile);
  return Boolean(deck && deck.start.x === ordered[0]!.start.x && deck.start.z === ordered[0]!.start.z &&
    deck.end.x === ordered.at(-1)!.end.x && deck.end.z === ordered.at(-1)!.end.z);
};

/**
 * Saved removals agree with the saved roads and sites: a closing bridge is a closed road group with
 * the same span, a dismantling one is gone from the roads, every closed group has its removal, and
 * no construction or upgrade site names a bridge that is being removed.
 */
export const bridgeRemovalsProblem = (
  value: unknown, roads: readonly RoadSegment[], buildings: readonly unknown[]
): string | null => {
  if (value === undefined) return bridgeDecks(roads).some(deck => deck.closed) ? "Closed bridge without removal" : null;
  if (!Array.isArray(value)) return "Invalid bridge removals";
  for (const entry of value) {
    const problem = entryProblem(entry);
    if (problem) return problem;
  }
  const removals = value as BridgeRemoval[];
  const ids = new Set(removals.map(entry => entry.id));
  if (ids.size !== removals.length) return "Duplicate bridge removal";
  const decks = new Map(bridgeDecks(roads).map(deck => [deck.id, deck]));
  for (const removal of removals) {
    const deck = decks.get(removal.id);
    if (removal.phase === "dismantling" ? deck !== undefined : !deck?.closed || !sameEnds(removal, roads))
      return "Bridge removal does not match the roads";
  }
  if ([...decks.values()].some(deck => deck.closed && !ids.has(deck.id))) return "Closed bridge without removal";
  const siteIds = buildings.flatMap(building => isSaveObject(building) && isSaveObject(building.bridgeSite)
    ? [building.bridgeSite.id] : []);
  return siteIds.some(id => ids.has(id as number)) ? "Bridge site names a bridge being removed" : null;
};
