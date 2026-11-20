import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import type { MilitaryTroopType } from "../../../shared/settlement/military-combat-rules";
import { isShallowEqual } from "../../components/ui-store";
import { troopPortrait } from "../../settlement/army-icons";
import { troopPluralName } from "../../settlement/troop-names";
import { getWorkforceCells } from "../building-details/workforce-helpers";
import { formatPopulation } from "../helpers";
import { getSettlementInventoryEntries } from "../inventory";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementUiSnapshot } from "../types";

/** Realm stock and the player level that decides which building materials are visible. */
export interface SummaryResources {
  level: number;
  resources?: Readonly<Record<string, number>>;
}

export const selectSummaryResources = ({ player, resources }: SettlementUiSnapshot): SummaryResources =>
  ({ level: player?.level ?? 1, resources });

/** Same level and the same count for every ware (the tick publishes a new stock object each time). */
export const isSameSummaryResources = (left: SummaryResources, right: SummaryResources) =>
  left.level === right.level && isShallowEqual(left.resources, right.resources);

/** Settlers tab data: people on the island, workers by job and soldiers by troop type. */
export interface SummaryPeople {
  availableSettlers?: number;
  militaryUnits?: Readonly<Partial<Record<MilitaryTroopType, number>>>;
  nation: string;
  population?: number;
  populationLimit?: number;
  workforce?: Readonly<Record<string, number>>;
}

export const selectSummaryPeople = ({
  availableSettlers, militaryUnits, player, population, populationLimit, workforce
}: SettlementUiSnapshot): SummaryPeople => ({
  availableSettlers,
  militaryUnits,
  nation: player?.nation ?? "roman",
  population,
  populationLimit,
  workforce
});

/** Same totals, jobs and troops; the tick rebuilds these maps every time. */
export const isSameSummaryPeople = (left: SummaryPeople, right: SummaryPeople) =>
  left.availableSettlers === right.availableSettlers &&
  left.nation === right.nation &&
  left.population === right.population &&
  left.populationLimit === right.populationLimit &&
  isShallowEqual(left.militaryUnits, right.militaryUnits) &&
  isShallowEqual(left.workforce, right.workforce);

const TROOP_TYPES: readonly MilitaryTroopType[] = ["shield", "heavy", "archer", "cavalry"];

/** Workers with a nonzero count, in the same profession order as a storage's settlers page. */
const getSummaryWorkerRows = (workforce: Readonly<Record<string, number>> = {}, i18n?: I18n) =>
  getWorkforceCells(workforce, 0, i18n).filter(cell => cell.job !== "available" && cell.count !== "0");

/** Soldiers with a nonzero count, grouped by the nation's troop names and portraits. */
const getSummaryMilitaryRows = (
  units: Readonly<Partial<Record<MilitaryTroopType, number>>> = {}, nation = "roman", i18n?: I18n
) => TROOP_TYPES.flatMap(type => {
  const count = units[type] ?? 0;
  if (count <= 0) return [];
  const label = troopPluralName(nation, type);
  return [{ count: String(count), icon: troopPortrait(nation, type), label,
    title: translateMessage(i18n, M.summary.count, { count, label }), type }];
});

/** What the Settlers tab shows, including the two settler totals. */
export const getSummaryPeopleView = (people: SummaryPeople, i18n?: I18n) => {
  const workers = getSummaryWorkerRows(people.workforce, i18n);
  const military = getSummaryMilitaryRows(people.militaryUnits, people.nation, i18n);
  return {
    idleSettlers: people.availableSettlers === undefined ? "—" : String(people.availableSettlers),
    military,
    population: people.population === undefined
      ? "—" : formatPopulation(people.population, people.populationLimit),
    workers
  };
};

const compactNumber = new Intl.NumberFormat(undefined, { notation: "compact" });

/** Resource tiles in inventory order, materials hidden until the player's level unlocks them. */
export const getSummaryResourceRows = ({ level, resources }: SummaryResources, i18n?: I18n) =>
  getSettlementInventoryEntries(resources, level).map(({ count, name, ware }) =>
    ({ label: translateMessage(i18n, M.summary.count, { count, label: name }), name,
      value: compactNumber.format(count), ware }));
