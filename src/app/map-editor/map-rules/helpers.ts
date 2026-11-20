import { starterStockForNation } from "@shared/catalog/balance";

import { MAX_PLAYER_LEVEL } from "../../../../../island-of-settlers-shared/src/catalog/balance/levels";
import { MIN_PLAYER_LEVEL } from "../../../../../island-of-settlers-shared/src/game-settings/constants";
import type { SimFeatureKey } from "../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { isOrdinaryTroopType } from "../../../shared/settlement/military-combat-rules";
import { MAX_START_SETTLERS, MAX_START_STOCK_AMOUNT, START_TROOP_LIMITS } from "../../../shared/world/constants";
import type { MapScenario } from "../../../shared/world/map-scenario";
import type { MapRules } from "../../../shared/world/scenario-map-rules";
import { scenarioStartStock } from "../../../shared/world/scenario-start-stock";
import type { ScenarioStartTroop } from "../../../shared/world/scenario-start-troops";
import { goodsRewardEntries, type RewardEntry } from "../../settlement-ui/reward-icons/entries";

/** What the Map rules section shows of the scenario (a plain copy, published after each edit). */
export interface MapRulesState {
  kind: MapScenario["kind"];
  nation: string;
  rewardCoins: number;
  rules: MapRules;
  settlers: number;
  startSetupOff: boolean;
  startTroops: readonly ScenarioStartTroop[];
  stock: Readonly<Record<string, number>>;
}

export interface StartSetup {
  settlers: number;
  startTroops: ScenarioStartTroop[];
  stock: Record<string, number>;
}

export type MapRuleFlag = "experience" | "talents";

export const toMapRulesState = (scenario: MapScenario): MapRulesState => ({
  kind: scenario.kind, nation: scenario.nation, rewardCoins: scenario.rewardCoins,
  rules: structuredClone(scenario.rules ?? {}), settlers: scenario.settlers,
  startSetupOff: scenario.startSetup === "off", startTroops: structuredClone(scenario.startTroops ?? []),
  stock: { ...scenario.stock }
});

export const clampWhole = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(value)));

/** Wares, settlers and soldiers as reward picker lines (the start setup and a computer faction's depot). */
export const startPickerEntries = (
  stock: Readonly<Record<string, number>>, settlers: number, troops: readonly ScenarioStartTroop[]
): RewardEntry[] => [
  ...goodsRewardEntries(stock),
  ...(settlers > 0 ? [{ amount: settlers, kind: "settlers" as const }] : []),
  ...troops.map(({ count, rank, type }): RewardEntry => ({ amount: count, kind: "soldier", rank, soldierType: type }))
];

/** The start setup as picker lines: the effective wares (authored or nation default), settlers, soldiers. */
export const startSetupEntries = (state: MapRulesState): RewardEntry[] =>
  startPickerEntries(scenarioStartStock(state.stock, state.nation), state.settlers, state.startTroops);

const sameGoods = (left: Readonly<Record<string, number>>, right: Readonly<Record<string, number>>) => {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key]);
};

/** The picker's coin and ware lines as a stock record, clamped to the map file limits. */
export const goodsFromEntries = (entries: readonly RewardEntry[]) => {
  const stock: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.kind === "coins") stock.coins = clampWhole(entry.amount, 0, MAX_START_STOCK_AMOUNT);
    if (entry.kind === "ware") stock[entry.ware] = clampWhole(entry.amount, 0, MAX_START_STOCK_AMOUNT);
  }
  return stock;
};

const entryStock = (entries: readonly RewardEntry[], nation: string) => {
  const stock = goodsFromEntries(entries);
  // The unchanged nation default stays "empty", so the map keeps following its nation (GS-MAP).
  if (sameGoods(stock, starterStockForNation(nation))) return {};
  return stock;
};

/** The picker's soldier lines as start troops, clamped to the map file's troop limits. */
export const troopsFromEntries = (entries: readonly RewardEntry[]) => {
  const troops: ScenarioStartTroop[] = [];
  let room = START_TROOP_LIMITS.total;
  for (const entry of entries) {
    if (entry.kind !== "soldier" || !isOrdinaryTroopType(entry.soldierType) || room <= 0) continue;
    const count = clampWhole(entry.amount, 1, room);
    troops.push({ count, rank: clampWhole(entry.rank ?? 0, 0, START_TROOP_LIMITS.maxRank), type: entry.soldierType });
    room -= count;
  }
  return troops.slice(0, START_TROOP_LIMITS.lines);
};

/** The picker lines back as map file fields, clamped to the map file limits. */
export const startSetupFromEntries = (entries: readonly RewardEntry[], nation: string): StartSetup => {
  const settlers = entries.find(entry => entry.kind === "settlers");
  return {
    settlers: settlers ? clampWhole(settlers.amount, 0, MAX_START_SETTLERS) : 0,
    startTroops: troopsFromEntries(entries),
    stock: entryStock(entries, nation)
  };
};

export const applyStartSetup = (scenario: MapScenario, { settlers, startTroops, stock }: StartSetup) => {
  scenario.stock = stock;
  scenario.settlers = settlers;
  if (startTroops.length) scenario.startTroops = startTroops;
  else delete scenario.startTroops;
};

/** Rules without empty parts; undefined when nothing is overridden (so files without rules stay unchanged). */
export const normalizeMapRules = (rules: MapRules): MapRules | undefined => {
  const next: MapRules = { ...rules };
  if (next.features && !Object.keys(next.features).length) delete next.features;
  return Object.keys(next).length ? next : undefined;
};

export const applyMapRules = (scenario: MapScenario, rules: MapRules) => {
  const next = normalizeMapRules(rules);
  if (next) scenario.rules = next;
  else delete scenario.rules;
};

export const withFeatureToggled = (rules: MapRules, key: SimFeatureKey): MapRules => {
  const features = { ...rules.features };
  if (features[key] === "off") delete features[key];
  else features[key] = "off";
  return { ...rules, features };
};

export const withFlagToggled = (rules: MapRules, flag: MapRuleFlag): MapRules => {
  const next = { ...rules };
  if (next[flag] === "none") delete next[flag];
  else next[flag] = "none";
  return next;
};

export const withCatchUpToggled = (rules: MapRules): MapRules => {
  const next = { ...rules };
  if (next.offlineCatchUp === "skip") delete next.offlineCatchUp;
  else next.offlineCatchUp = "skip";
  return next;
};

/** A typed level (clamped to the player levels), or no fixed level for a blank or invalid text. */
export const withFixedLevel = (rules: MapRules, text: string): MapRules => {
  const next = { ...rules };
  const level = Number(text);
  if (!text.trim() || !Number.isFinite(level)) delete next.level;
  else next.level = { kind: "fixed", level: clampWhole(level, MIN_PLAYER_LEVEL, MAX_PLAYER_LEVEL) };
  return next;
};

export const allowsFixedLevel = (kind: MapScenario["kind"]) => kind === "campaign" || kind === "adventure";
export const allowsCatchUpSkip = (kind: MapScenario["kind"]) => kind === "adventure" || kind === "colony";

/** A kind change drops what the new kind forbids, so the map file stays valid (the guard would refuse it). */
export const dropForbiddenRules = (scenario: MapScenario) => {
  if (scenario.kind !== "campaign") delete scenario.startSetup;
  if (scenario.kind === "home") delete scenario.factionAi;
  if (!scenario.rules) return;
  const rules = { ...scenario.rules };
  if (!allowsFixedLevel(scenario.kind)) delete rules.level;
  if (scenario.kind === "home") delete rules.offlineCatchUp;
  applyMapRules(scenario, rules);
};
