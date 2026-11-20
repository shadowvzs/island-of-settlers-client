import { secondsToTicks } from "../../../../island-of-settlers-shared/src/time/constants";
import { HIT_ALERT_SECONDS, KNOWLEDGE_MEMORY_SECONDS } from "../balance/vision";
import type { GarrisonCount } from "./commander/known-sites";
import { knownSitesSaveError } from "./commander/known-sites";
import { scoutPlansSaveError } from "./commander/scout-plan";
import { sectorStalenessSaveError } from "./commander/sector-staleness";
import type { StrategicSite } from "./commander/site-index";
import { createStrategicKnowledge, type StrategicKnowledgeSave } from "./commander/strategic-knowledge";
import type { FactionVision } from "./faction-vision";
import { isMilitaryTroopType, type MilitaryTroopType } from "./military-combat-rules";

/**
 * What each faction knows about enemy soldiers (A13 phase 3, owner decision D-AI1: no hidden AI vision):
 * - **seen**: the faction's vision layer covers the unit's cell now (the layer of the previous tick's end);
 * - **hit alert**: a unit that struck one of the faction's soldiers is known for `HIT_ALERT_SECONDS`;
 * - **last known**: the computer factions remember where they last knew a unit (position, strength, tick)
 *   for `KNOWLEDGE_MEMORY_SECONDS`. Only the commander reads these memories; soldiers target live, known
 *   units only.
 * Expiry compares absolute game ticks, so skipped and offline ticks age the knowledge exactly like played
 * ones; expired entries are absent for every read and never saved, so when the garbage is swept is free.
 */
export const KNOWLEDGE_MEMORY_TICKS = secondsToTicks(KNOWLEDGE_MEMORY_SECONDS);
export const HIT_ALERT_TICKS = secondsToTicks(HIT_ALERT_SECONDS);

export interface KnowledgeBody { uid: number; x: number; z: number }

/** An enemy soldier as an observer may learn it (the commander's strength inputs). */
export interface ObservedUnit extends KnowledgeBody {
  faction: number;
  /** Health share left (0-1). */
  health: number;
  rank: number;
  type: MilitaryTroopType;
}

/**
 * A remembered unit: its state when its viewer last knew it, at game tick `tick`, and the tick since which the
 * viewer has known it without a break (`firstKnownTick`, A14-4b: the reaction delay of A14-5 reads it).
 */
export interface KnownUnitRecord extends ObservedUnit { firstKnownTick: number; tick: number }

/** Saved record: [viewer, uid, unit faction, type, rank, health, x, z, tick, firstKnownTick (format 12)]. */
type RecordEntry = [number, number, number, MilitaryTroopType, number, number, number, number, number, number?];

export interface FactionKnowledgeSave extends StrategicKnowledgeSave {
  /** [viewer faction, attacker uid, tick until which the attacker is known]. */
  alerts: [number, number, number][];
  /** BD1 (formats ≤ 11, read only): [viewer, building uid] of the enemy buildings seen; format 12 has `sites`. */
  buildings?: [number, number][];
  records: RecordEntry[];
}

/** A building as an observer sees it: its plot centre, entrance, type and owner. */
export type KnowledgeSite = StrategicSite;

interface KnowledgeSources {
  /** Every building on the island (BD1: computer factions remember the enemy buildings they saw). */
  buildings?: () => readonly KnowledgeSite[];
  /** One building by uid (absent: a search of `buildings`). */
  building?: (uid: number) => KnowledgeSite | undefined;
  /** The soldiers inside a building now (A14-4b garrison sightings; absent: none seen). */
  garrison?: (uid: number) => GarrisonCount | undefined;
  /** The building a soldier shoots or strikes from (a garrison post), if any: a hit alert reveals it. */
  stationedIn?: (uid: number) => number | undefined;
  /** The vision layer whose sight changes drive the strategic knowledge (absent: no sites are learned). */
  vision?: () => FactionVision | undefined;
  /** The game tick (absolute, saved). */
  now: () => number;
  /**
   * True when `viewer`'s troops may act on every enemy (the player troop sight rule off; never a computer
   * faction, D-AI1). Absent: every faction's troops act on knowledge only.
   */
  omniscient?: (viewer: number) => boolean;
  /** The faction vision layer; absent (bare fixtures without one): every unit is known. */
  sees?: () => ((faction: number, x: number, z: number) => boolean) | undefined;
  /** Every soldier standing in the field or at a siege this tick (any faction). */
  units: () => readonly ObservedUnit[];
}

const byNumber = (a: number, b: number) => a - b;
const isCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const isFiniteNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value);

const nestedOf = <Value>(maps: Map<number, Map<number, Value>>, viewer: number) => {
  let map = maps.get(viewer);
  if (!map) { map = new Map(); maps.set(viewer, map); }
  return map;
};

/** Sorted [viewer, uid, value] triples of every entry `keep` accepts (canonical save order). */
const sortedEntries = <Value>(maps: Map<number, Map<number, Value>>, keep: (value: Value) => boolean) => {
  const out: [number, number, Value][] = [];
  for (const viewer of [...maps.keys()].sort(byNumber)) {
    const map = maps.get(viewer)!;
    for (const uid of [...map.keys()].sort(byNumber)) {
      const value = map.get(uid)!;
      if (keep(value)) out.push([viewer, uid, value]);
    }
  }
  return out;
};

const upsertRecord = (map: Map<number, KnownUnitRecord>, unit: ObservedUnit, tick: number) => {
  const record = map.get(unit.uid);
  if (!record) {
    map.set(unit.uid, { faction: unit.faction, firstKnownTick: tick, health: unit.health, rank: unit.rank, tick,
      type: unit.type, uid: unit.uid, x: unit.x, z: unit.z });
    return;
  }
  // Known again after a gap (only remembered meanwhile): the continuous knowledge starts anew.
  if (record.tick !== tick - 1) record.firstKnownTick = tick;
  record.faction = unit.faction; record.health = unit.health; record.rank = unit.rank; record.tick = tick;
  record.type = unit.type; record.x = unit.x; record.z = unit.z;
};

// One closure over the alert and memory maps; every read is allocation free.
// oxlint-disable-next-line max-lines-per-function
export const createFactionKnowledge = ({
  building, buildings: buildingsNow = () => [], garrison = () => undefined, now, omniscient = () => false, sees,
  stationedIn = () => undefined, units: unitsNow, vision = () => undefined
}: KnowledgeSources) => {
  const alerts = new Map<number, Map<number, number>>();
  /** Enemy buildings each computer faction has seen, sectors and scout plans (A14-4b strategic knowledge). */
  const strategic = createStrategicKnowledge({ building: building ??
    (uid => buildingsNow().find(site => site.uid === uid)), buildings: buildingsNow, garrison, now, vision });
  const records = new Map<number, Map<number, KnownUnitRecord>>();
  const viewers: number[] = [];
  const present = new Set<number>();
  const recordLive = (record: KnownUnitRecord, tick: number) => tick - record.tick <= KNOWLEDGE_MEMORY_TICKS;
  const alerted = (viewer: number, uid: number) => {
    const until = alerts.get(viewer)?.get(uid);
    return until !== undefined && now() < until;
  };
  const knows = (viewer: number, body: KnowledgeBody) => {
    const layer = sees?.();
    if (!layer) return true;
    return layer(viewer, body.x, body.z) || alerted(viewer, body.uid);
  };
  /** `viewer` knows `body` only by a hit alert: struck from outside its sight (A14 plan §6, alert exposure). */
  const knowsByAlertOnly = (viewer: number, body: KnowledgeBody) => {
    const layer = sees?.();
    return layer !== undefined && !layer(viewer, body.x, body.z) && alerted(viewer, body.uid);
  };
  /**
   * Whether `viewer`'s troops may act on `body`: everything while the sight rule waives knowledge for that
   * faction, else what it knows. Civilian flight and the commander read `knows` (never waived).
   */
  const troopKnows = (viewer: number, body: KnowledgeBody) => omniscient(viewer) || knows(viewer, body);
  /** Whether `viewer`'s layer sees the building's centre or its entrance now. */
  const seesSite = (layer: (faction: number, x: number, z: number) => boolean, viewer: number, site: KnowledgeSite) =>
    layer(viewer, site.x, site.z) || layer(viewer, site.access.x, site.access.z);
  /**
   * Whether `viewer` may choose this building as a target (A13 knowledge-only targeting, BD1): seen now,
   * seen before (remembered), or everything while the sight rule waives knowledge (no layer: all known).
   */
  const knowsBuilding = (viewer: number, site: KnowledgeSite) => {
    if (omniscient(viewer)) return true;
    const layer = sees?.();
    return !layer || strategic.site(viewer, site.uid) !== undefined || seesSite(layer, viewer, site);
  };
  /** A removed building is forgotten by every faction. */
  const forgetBuilding = (uid: number) => strategic.forget(uid);
  /** The computer factions among `units`, ascending, in a reused array. */
  const viewersOf = (units: readonly ObservedUnit[]) => {
    viewers.length = 0;
    for (const unit of units) if (unit.faction > 0 && !viewers.includes(unit.faction)) viewers.push(unit.faction);
    return viewers.sort(byNumber);
  };
  /** Drops expired memories and alerts (garbage only: reads already treat them as absent). */
  const sweep = (tick: number) => {
    for (const map of records.values())
      for (const [uid, record] of map) if (!recordLive(record, tick)) map.delete(uid);
    for (const map of alerts.values())
      for (const [uid, until] of map) if (tick >= until) map.delete(uid);
  };
  /**
   * A unit its viewer knew on the previous tick that has now left the field (fallen, gone inside, aboard) went
   * in front of the viewer's eyes: it is forgotten, not remembered as a ghost where it vanished.
   */
  const forgetWitnessed = (tick: number) => {
    for (const map of records.values())
      for (const [uid, record] of map) if (record.tick === tick - 1 && !present.has(uid)) map.delete(uid);
  };
  /**
   * The vision phase (end of every tick, also after skipped ticks): each computer faction with a soldier in the
   * field refreshes its memory of every enemy soldier it knows now.
   */
  const observe = () => {
    const tick = now(), units = unitsNow();
    present.clear();
    for (const unit of units) present.add(unit.uid);
    forgetWitnessed(tick);
    const viewersNow = viewersOf(units);
    for (const viewer of viewersNow) {
      const map = nestedOf(records, viewer);
      for (const unit of units) if (unit.faction !== viewer && knows(viewer, unit)) upsertRecord(map, unit, tick);
    }
    strategic.observe();
    sweep(tick);
  };
  /** A blow from `attacker` on a soldier of `viewer`: the attacker is known to that faction for a while. */
  const alert = (viewer: number, attacker: number) => {
    const map = nestedOf(alerts, viewer), until = now() + HIT_ALERT_TICKS;
    map.set(attacker, Math.max(map.get(attacker) ?? 0, until));
    const post = stationedIn(attacker);
    if (viewer > 0 && post !== undefined) strategic.revealSite(viewer, post);
  };
  /** Live memories of `viewer` that `skip` does not reject, in uid order (identical before and after a load). */
  const remembered = (viewer: number, skip: (uid: number) => boolean) => {
    const map = records.get(viewer);
    if (!map?.size) return [];
    const tick = now(), out: KnownUnitRecord[] = [];
    for (const record of map.values()) if (recordLive(record, tick) && !skip(record.uid)) out.push(record);
    return out.sort((a, b) => a.uid - b.uid);
  };
  const save = (): FactionKnowledgeSave => {
    const tick = now();
    return {
      alerts: sortedEntries(alerts, until => tick < until).map(([viewer, uid, until]) => [viewer, uid, until]),
      records: sortedEntries(records, record => recordLive(record, tick)).map(([viewer, uid, record]) =>
        [viewer, uid, record.faction, record.type, record.rank, record.health, record.x, record.z, record.tick,
          record.firstKnownTick]),
      ...strategic.save()
    };
  };
  /** A load; a format ≤ 11 save's seen buildings migrate into the ledger and its records start known then. */
  const restore = (saved: FactionKnowledgeSave | undefined) => {
    alerts.clear(); records.clear();
    strategic.restore(saved, saved?.buildings);
    for (const [viewer, uid, until] of saved?.alerts ?? []) nestedOf(alerts, viewer).set(uid, until);
    for (const [viewer, uid, faction, type, rank, health, x, z, tick, firstKnownTick] of saved?.records ?? [])
      nestedOf(records, viewer).set(uid, { faction, firstKnownTick: firstKnownTick ?? tick, health, rank, tick, type,
        uid, x, z });
  };
  /** Since when `viewer` has known the enemy soldier without a break (undefined: not remembered now). */
  const knownSince = (viewer: number, uid: number) => {
    const record = records.get(viewer)?.get(uid);
    return record && recordLive(record, now()) ? record.firstKnownTick : undefined;
  };
  const stats = () => {
    let memories = 0, alertCount = 0;
    for (const map of records.values()) memories += map.size;
    for (const map of alerts.values()) alertCount += map.size;
    return { alerts: alertCount, ...strategic.stats(), memories };
  };
  return {
    alert, alerted, forgetBuilding, knownSince, knows, knowsBuilding, knowsByAlertOnly, now, observe, omniscient,
    remembered, restore, save, stats, strategic, troopKnows
  };
};

export type FactionKnowledge = ReturnType<typeof createFactionKnowledge>;

const isAlertEntry = (entry: unknown) => Array.isArray(entry) && entry.length === 3 && entry.every(isCount);
const isSiteEntry = (entry: unknown) => Array.isArray(entry) && entry.length === 2 && entry.every(isCount);

const isRecordEntry = (entry: unknown) => {
  if (!Array.isArray(entry) || (entry.length !== 9 && entry.length !== 10)) return false;
  const [viewer, uid, faction, type, rank, health, x, z, tick, first] = entry as unknown[];
  const firstValid = first === undefined || (isCount(first) && (first as number) <= (tick as number));
  return [viewer, uid, faction, rank, tick].every(isCount) && isMilitaryTroopType(type) &&
    [health, x, z].every(isFiniteNumber) && (health as number) >= 0 && firstValid;
};

/** The A14-4b parts (absent is valid: nothing known, no sector seen, no scout plan). */
const strategicSaveError = ({ scouting, sectors, sites }: StrategicKnowledgeSave) =>
  (sites === undefined ? null : knownSitesSaveError(sites)) ??
  (sectors === undefined ? null : sectorStalenessSaveError(sectors)) ??
  (scouting === undefined ? null : scoutPlansSaveError(scouting));

/** Null when the saved knowledge is well formed (absent is valid: an older save knows nothing yet). */
export const factionKnowledgeSaveError = (saved: unknown) => {
  if (saved === undefined) return null;
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return "Invalid faction knowledge";
  const { alerts, buildings, records } = saved as Partial<FactionKnowledgeSave>;
  if (!Array.isArray(alerts) || !alerts.every(isAlertEntry)) return "Invalid faction knowledge alerts";
  if (buildings !== undefined && (!Array.isArray(buildings) || !buildings.every(isSiteEntry)))
    return "Invalid faction knowledge buildings";
  if (!Array.isArray(records) || !records.every(isRecordEntry)) return "Invalid faction knowledge records";
  return strategicSaveError(saved as StrategicKnowledgeSave);
};
