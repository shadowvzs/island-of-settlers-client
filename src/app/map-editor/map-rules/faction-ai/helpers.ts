import { WARE_IDS } from "../../../../render-common/wares/ware-catalog";
import {
  FACTION_AI_BONUS_PERCENT_RANGE, FACTION_AI_LEVELS, FACTION_AI_LIMIT_RANGES, MAX_START_SETTLERS
} from "../../../../shared/world/constants";
import type { MapScenario } from "../../../../shared/world/map-scenario";
import type {
  FactionAiLevel, FactionAiMode, FactionAiStyle, ScenarioFactionAi, ScenarioFactionAiStart
} from "../../../../shared/world/scenario-faction-ai";
import {
  checkFactionAi, type FactionAiCheckContext, type FactionAiIssue
} from "../../../../shared/world/scenario-faction-ai-issues";
import { HUMAN_FACTION, MAX_FACTION } from "../../../../shared/world/scenario-players";
import type { RewardEntry } from "../../../settlement-ui/reward-icons/entries";
import { clampWhole, goodsFromEntries, startPickerEntries, troopsFromEntries } from "../helpers";
import { DEFAULT_FACTION_AI_STYLE, type FactionAiBonusKey, type FactionAiLimitKey } from "./constants";

/** What the Computer factions rows show of the scenario (a plain copy, published after each edit). */
export interface FactionAiState {
  /** The authored entries (never `none`), by faction. */
  entries: readonly ScenarioFactionAi[];
  /** One row per faction the map uses, plus rows the map maker added this session; ascending. */
  factions: readonly number[];
  /** `checkFactionAi` with the map's cells (errors first, then warnings). */
  issues: readonly FactionAiIssue[];
  kind: MapScenario["kind"];
  nation: string;
  /** The look of factions that a `nation` player slot names. */
  slotNations: Readonly<Record<number, string>>;
}

type EntryChange = (entry: ScenarioFactionAi) => ScenarioFactionAi;

const isComputerFaction = (faction: number) => faction > HUMAN_FACTION && faction <= MAX_FACTION;

/** The factions the map uses (units, buildings, player slots, AI entries) and the added rows, ascending. */
export const usedFactions = (scenario: MapScenario, added: readonly number[] = []) => {
  const factions = new Set<number>(added);
  const owners = [...scenario.units, ...scenario.buildings, ...scenario.players ?? [], ...scenario.factionAi ?? []];
  for (const owner of owners) factions.add(owner.faction);
  return [...factions].filter(isComputerFaction).sort((left, right) => left - right);
};

/** The lowest computer faction without a row, or undefined when every faction has one. */
export const nextFreeFaction = (factions: readonly number[]) => {
  for (let faction = HUMAN_FACTION + 1; faction <= MAX_FACTION; faction++)
    if (!factions.includes(faction)) return faction;
  return undefined;
};

const slotNations = (scenario: MapScenario) => Object.fromEntries((scenario.players ?? [])
  .filter(slot => slot.nation !== undefined).map(slot => [slot.faction, slot.nation!]));

export const toFactionAiState = (
  scenario: MapScenario, cells: FactionAiCheckContext = {}, added: readonly number[] = []
): FactionAiState => ({
  entries: structuredClone(scenario.factionAi ?? []), factions: usedFactions(scenario, added),
  issues: checkFactionAi(scenario, { cellsX: cells.cellsX, cellsZ: cells.cellsZ }), kind: scenario.kind,
  nation: scenario.nation, slotNations: slotNations(scenario)
});

const byFaction = (left: ScenarioFactionAi, right: ScenarioFactionAi) => left.faction - right.faction;

/** The list with one faction's entry changed; an absent entry stays absent (only a mode creates one). */
const withEntry = (entries: readonly ScenarioFactionAi[], faction: number, change: EntryChange) => entries
  .map(entry => entry.faction === faction ? change(structuredClone(entry)) : entry);

/** `none` removes the entry (absent = none); leaving `develop` drops the style the guard would refuse. */
export const withFactionMode = (entries: readonly ScenarioFactionAi[], faction: number, mode: FactionAiMode) => {
  const others = entries.filter(entry => entry.faction !== faction);
  if (mode === "none") return others;
  const next: ScenarioFactionAi = { ...structuredClone(entries.find(entry => entry.faction === faction)), faction,
    mode };
  if (mode !== "develop") delete next.style;
  return [...others, next].sort(byFaction);
};

/** Develop only; balanced is stored as no style. */
export const withFactionStyle = (entries: readonly ScenarioFactionAi[], faction: number, style: FactionAiStyle) =>
  withEntry(entries, faction, entry => {
    if (entry.mode !== "develop") return entry;
    if (style === DEFAULT_FACTION_AI_STYLE) delete entry.style;
    else entry.style = style;
    return entry;
  });

const isLevel = (value: string): value is FactionAiLevel => (FACTION_AI_LEVELS as readonly string[]).includes(value);

/** A level, or no level (the island's difficulty) for any other value. */
export const withFactionLevel = (entries: readonly ScenarioFactionAi[], faction: number, value: string) =>
  withEntry(entries, faction, entry => {
    if (isLevel(value)) entry.level = value;
    else delete entry.level;
    return entry;
  });

/** A typed whole number clamped to the range, or undefined for a blank or invalid text. */
export const parseClamped = (text: string, [min, max]: readonly [number, number]) => {
  const value = Number(text);
  if (!text.trim() || !Number.isFinite(value)) return undefined;
  return clampWhole(value, min, max);
};

/** A limit clamped to the owner's caps; blank restores the mode default. */
export const withFactionLimit = (
  entries: readonly ScenarioFactionAi[], faction: number, key: FactionAiLimitKey, text: string
) => withEntry(entries, faction, entry => {
  const limits = { ...entry.limits }, value = parseClamped(text, FACTION_AI_LIMIT_RANGES[key]);
  if (value === undefined) delete limits[key];
  else limits[key] = value;
  if (Object.keys(limits).length) entry.limits = limits;
  else delete entry.limits;
  return entry;
});

/** A bonus clamped to 100–300 %; blank or 100 (no handicap) removes it. */
export const withFactionBonus = (
  entries: readonly ScenarioFactionAi[], faction: number, key: FactionAiBonusKey, text: string
) => withEntry(entries, faction, entry => {
  const bonus = { ...entry.bonus }, value = parseClamped(text, FACTION_AI_BONUS_PERCENT_RANGE);
  if (value === undefined || value === FACTION_AI_BONUS_PERCENT_RANGE[0]) delete bonus[key];
  else bonus[key] = value;
  if (Object.keys(bonus).length) entry.bonus = bonus;
  else delete entry.bonus;
  return entry;
});

const isWare: (key: string) => boolean = Set.prototype.has.bind(new Set<string>(WARE_IDS));

/** The picker lines as a depot start; undefined when nothing is left (no `start`). */
export const depotStartFromEntries = (pickerEntries: readonly RewardEntry[]): ScenarioFactionAiStart | undefined => {
  const stock = Object.fromEntries(Object.entries(goodsFromEntries(pickerEntries))
    .filter(([ware, amount]) => isWare(ware) && amount > 0));
  const settlerEntry = pickerEntries.find(entry => entry.kind === "settlers");
  const settlers = settlerEntry ? clampWhole(settlerEntry.amount, 0, MAX_START_SETTLERS) : 0;
  const soldiers = troopsFromEntries(pickerEntries);
  if (!settlers && !soldiers.length && !Object.keys(stock).length) return undefined;
  return soldiers.length ? { settlers, soldiers, stock } : { settlers, stock };
};

export const withFactionStart = (
  entries: readonly ScenarioFactionAi[], faction: number, pickerEntries: readonly RewardEntry[]
) => withEntry(entries, faction, entry => {
  const start = depotStartFromEntries(pickerEntries);
  if (start) entry.start = start;
  else delete entry.start;
  return entry;
});

/** A depot start as picker lines (wares, settlers, soldiers). */
export const depotStartEntries = (entry: ScenarioFactionAi | undefined): RewardEntry[] => {
  const start = entry?.start;
  return start ? startPickerEntries(start.stock, start.settlers, start.soldiers ?? []) : [];
};

/** Writes the list; no `factionAi` key when every faction plays `none`, so old maps stay byte-identical. */
export const applyFactionAi = (scenario: MapScenario, entries: readonly ScenarioFactionAi[]) => {
  const active = entries.filter(entry => entry.mode !== "none");
  if (active.length) scenario.factionAi = structuredClone(active);
  else delete scenario.factionAi;
};
