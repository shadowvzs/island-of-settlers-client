import { effectiveRules } from "../../../../island-of-settlers-shared/src/game-settings/effective-rules";
import { isMapRules } from "../../../../island-of-settlers-shared/src/game-settings/game-settings-shape";
import type { MapRules } from "../../../../island-of-settlers-shared/src/game-settings/map-rules";
import {
  LEGACY_SIM_RULES, type SimRules
} from "../../../../island-of-settlers-shared/src/game-settings/sim-rules";
import { readMapFileHeader } from "../../../../island-of-settlers-shared/src/map-file";
import { base64ToBytes } from "../../../../island-of-settlers-shared/src/save-map-delta";
import { catchUpSubject } from "../../shared/campaign/campaign-run-game";
import type { AdventureRecord, Archipelago, ColonyRecord } from "../../shared/settlement/archipelago";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { type IslandRole, resolveIslandRole } from "../../shared/settlement/island-role";
import type { MapScenario } from "../../shared/world/map-scenario";

/**
 * Offline catch-up skip (plan §10, lane SKIP). Two decisions share the GS0 resolver (`effectiveRules`):
 * - the client's whole-save skip from the session rules and the pins (`sessionSkipsCatchUp`), never on the server
 *   (rev I5);
 * - the per-island skip of non-home islands whose map (or pin) skips (`detachSkippedIslands`,
 *   `onScreenSkipsCatchUp`), shared by the client and the server bundle so both reach identical saves.
 * Campaign maps keep their own mechanism (C2: the run is never caught up); nothing here touches them.
 */

/** One fixed tick: a shorter window replays nothing, so its island needs no decision. */
const OFFLINE_STEP_MS = 50;

type FiledPosition = "adventure" | "colony";
type IslandRecord = AdventureRecord | ColonyRecord;
interface ScenarioRules { kind?: MapScenario["kind"]; rules?: MapRules }

const SCENARIO_KINDS: readonly string[] = ["adventure", "campaign", "colony", "home"];

/** A save's replay cursor moved to `now`; its simulation state stays untouched. */
export const rebaseSaveClock = (save: GameSaveV1, now: number): GameSaveV1 => ({ ...save, savedAt: now });

/** The island's catch-up is skipped by these rules; the campaign role is left to its own mechanism (C2). */
export const islandSkipsCatchUp = (rules: { catchUp: SimRules["catchUp"] }, role: IslandRole) =>
  role !== "campaign" && rules.catchUp === "skip";

/**
 * The client's whole-save decision (startup and the saved-destination handoff): the session rules, known at boot,
 * or the pins of the game's home (or the island on screen), so a slot saved before its first adoption skips too.
 */
export const sessionSkipsCatchUp = (save: GameSaveV1, sessionRules?: Pick<SimRules, "catchUp">) => {
  if (sessionRules?.catchUp === "skip") return true;
  return catchUpSubject(save).settlement.gameRules?.catchUp === "skip";
};

const scenarioKind = (value: unknown): MapScenario["kind"] | undefined =>
  SCENARIO_KINDS.includes(String(value)) ? value as MapScenario["kind"] : undefined;

/** The map header's scenario kind and rules; a map that cannot be decoded has none (its replay reports why). */
const readScenarioRules = async (map: string): Promise<ScenarioRules> => {
  try {
    const header = await readMapFileHeader(base64ToBytes(map)) as { scenario?: { kind?: unknown; rules?: unknown } };
    const scenario = header?.scenario;
    if (!scenario || typeof scenario !== "object") return {};
    return { kind: scenarioKind(scenario.kind), rules: isMapRules(scenario.rules) ? scenario.rules : undefined };
  } catch {
    return {};
  }
};

/** Whether a colony or adventure save skips: its own pin narrowed by its map, resolved for its role. */
const filedIslandSkips = async (save: GameSaveV1, position: FiledPosition, now: number) => {
  if (now - save.savedAt < OFFLINE_STEP_MS) return false;
  const { kind, rules } = await readScenarioRules(save.map);
  const role = resolveIslandRole(kind, () => position === "colony", () => position === "adventure");
  return islandSkipsCatchUp(effectiveRules(save.settlement.gameRules ?? LEGACY_SIM_RULES, rules, role), role);
};

/** A skipped colony's missed ore-ship hours move with its clock, as in the whole-save skip. */
const deferredOreShip = (record: IslandRecord, awayMs: number) => {
  if (!("nextOreShipAt" in record) || record.nextOreShipAt === undefined) return {};
  return { nextOreShipAt: record.nextOreShipAt + awayMs };
};

const skippedRecord = <T extends IslandRecord>(record: T, save: GameSaveV1, now: number): T => ({
  ...record, ...deferredOreShip(record, Math.max(0, now - save.savedAt)), save: rebaseSaveClock(save, now)
});

/** The islands a replay leaves out: rebased, with their missed ore-ship hours deferred. */
export interface DetachedIslands {
  adventures: AdventureRecord[];
  colonies: ColonyRecord[];
  /** The group the replay advances: every skipped record removed. */
  group: Archipelago;
}

const skippedRecords = async <T extends IslandRecord>(
  records: readonly T[], position: FiledPosition, known: number | null, now: number
) => {
  const skipped: T[] = [];
  for (const record of records) {
    if (!record.save) continue;
    if (record.expeditionId === known || await filedIslandSkips(record.save, position, now))
      skipped.push(skippedRecord(record, record.save, now));
  }
  return skipped;
};

const withoutRecords = <T extends IslandRecord>(records: readonly T[], removed: readonly IslandRecord[]) =>
  records.filter(record => !removed.some(entry => entry.expeditionId === record.expeditionId));

/**
 * Filed colonies and adventures that skip (`known`: one already decided, the island just filed from the screen)
 * leave the replay entirely: no lane stages them, no supply or ore ship reaches them, so they gain nothing and keep
 * their script tick and world hour. Null when nothing skips.
 */
export const detachSkippedIslands = async (
  group: Archipelago, now: number, known: number | null = null
): Promise<DetachedIslands | null> => {
  const colonies = await skippedRecords(group.colonies, "colony", known, now);
  const adventures = await skippedRecords(group.adventures ?? [], "adventure", known, now);
  if (!colonies.length && !adventures.length) return null;
  const detached: Archipelago = { ...group, colonies: withoutRecords(group.colonies, colonies) };
  if (group.adventures) detached.adventures = withoutRecords(group.adventures, adventures);
  return { adventures, colonies, group: detached };
};

/** The original record order, then any record the replay added (arrivals); skipped records rejoin in place. */
const mergedRecords = <T extends IslandRecord>(
  original: readonly T[], advanced: readonly T[], skipped: readonly T[]
) => {
  const byId = new Map([...advanced, ...skipped].map(record => [record.expeditionId, record]));
  const ids = [...original.map(record => record.expeditionId), ...advanced.map(record => record.expeditionId)];
  return [...new Set(ids)].flatMap(id => byId.get(id) ?? []);
};

/** The skipped records back in the advanced group; their deadlines are aged by the caller. */
export const rejoinSkippedIslands = (
  advanced: Archipelago, original: Archipelago, detached: DetachedIslands
): Archipelago => {
  const rejoined: Archipelago = {
    ...advanced, colonies: mergedRecords(original.colonies, advanced.colonies, detached.colonies)
  };
  if (original.adventures || advanced.adventures)
    rejoined.adventures = mergedRecords(original.adventures ?? [], advanced.adventures ?? [], detached.adventures);
  return rejoined;
};

const onScreenPosition = (group: Archipelago): FiledPosition | null => {
  if (group.colonies.some(record => record.expeditionId === group.active)) return "colony";
  return group.adventures?.some(record => record.expeditionId === group.active) ? "adventure" : null;
};

/** Whether the colony or adventure on screen skips (the home on screen never takes a map skip). */
export const onScreenSkipsCatchUp = async (save: GameSaveV1, now: number) => {
  const group = save.archipelago;
  const position = group && group.active !== null ? onScreenPosition(group) : null;
  return position !== null && filedIslandSkips(save, position, now);
};

const filedSave = ({ archipelago: _group, campaignRun: _run, player: _player, ...island }: GameSaveV1) =>
  island as GameSaveV1;

const mapRecords = <T extends IslandRecord>(records: readonly T[], id: number, map: (record: T) => T) =>
  records.map(record => record.expeditionId === id ? map(record) : record);

const withRecord = (group: Archipelago, id: number, map: (record: IslandRecord) => IslandRecord): Archipelago => ({
  ...group,
  colonies: mapRecords(group.colonies, id, map as (record: ColonyRecord) => ColonyRecord),
  ...(group.adventures
    ? { adventures: mapRecords(group.adventures, id, map as (record: AdventureRecord) => AdventureRecord) } : {})
});

const recordOf = (group: Archipelago, id: number): IslandRecord | undefined =>
  group.colonies.find(record => record.expeditionId === id) ??
  group.adventures?.find(record => record.expeditionId === id);

/**
 * The skipping island on screen is filed and the filed home comes on screen, so home and the other islands replay
 * as in any home session (the filed island is then detached like any skipped one). Undefined without a filed home.
 */
export const fileSkippedOnScreen = (save: GameSaveV1): GameSaveV1 | undefined => {
  const group = save.archipelago;
  if (!group?.home || group.active === null) return undefined;
  const filed = withRecord(group, group.active, record => ({ ...record, save: filedSave(save) }));
  return { ...group.home, archipelago: { ...filed, active: null, home: undefined }, player: save.player };
};

/**
 * The island filed by `fileSkippedOnScreen` back on screen over the advanced home game. When it expired during the
 * replay, the player is home (as in any catch-up whose island on screen ended).
 */
export const returnSkippedOnScreen = (advanced: GameSaveV1, original: GameSaveV1): GameSaveV1 => {
  const id = original.archipelago!.active!, group = advanced.archipelago;
  const island = group && recordOf(group, id)?.save;
  if (!group || !island) return advanced;
  const previous = recordOf(original.archipelago!, id)?.save;
  const restored = withRecord(group, id, ({ save: _filed, ...record }) =>
    previous ? { ...record, save: previous } : record);
  return { ...island, archipelago: { ...restored, active: id, home: filedSave(advanced) }, player: advanced.player };
};
