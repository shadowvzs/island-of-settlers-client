import type { I18n } from "@lingui/core";

import { MAX_TAVERN_ORDER } from "../../../shared/balance/military";
import { displayJobName, displayWareName } from "../../../shared/i18n/domain";
import { translateMessage } from "../../../shared/i18n/translate";
import type { MilitaryTroopType, OrdinaryTroopType } from "../../../shared/settlement/military-combat-rules";
import { TAVERN_RECIPES, TAVERN_TROOPS } from "../../../shared/settlement/tavern-rules";
import { troopPortrait } from "../../settlement/army-icons";
import { troopName, troopPluralName } from "../../settlement/troop-names";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementTavernSummary } from "../types";

/** Panel-local choice of the Tavern: troop type and order count; reset when another building is shown. */
export interface TavernDraft {
  count: number;
  type: OrdinaryTroopType;
}
export const INITIAL_TAVERN_DRAFT: TavernDraft = { count: 1, type: "shield" };

const STAGE_LABELS = {
  collect: M.details.tavern.stageCollect,
  settler: M.details.tavern.stageSettler,
  train: M.details.tavern.stageTrain
} as const;

/** Order count after one step, kept within 1..MAX_TAVERN_ORDER. */
export const stepTavernCount = (count: number, delta: number) =>
  Math.max(1, Math.min(MAX_TAVERN_ORDER, count + delta));

export const getTavernTroops = (nation: string, selected: OrdinaryTroopType, i18n?: I18n) =>
  TAVERN_TROOPS.map(type => ({
    icon: troopPortrait(nation, type),
    label: translateMessage(i18n, M.details.tavern.recruit, {
      troop: troopPluralName(nation, type).toLowerCase()
    }),
    name: troopName(nation, type),
    pressed: type === selected,
    type
  }));

const getIngredient = (key: string, label: string, need: number, have: number, i18n?: I18n) => ({
  amount: translateMessage(i18n, M.details.tavern.amount, { have, need }),
  enough: String(have >= need),
  key,
  title: translateMessage(i18n, M.details.tavern.ingredient, { have, label, need })
});

/** Ingredients of one recruit: a settler plus the type's wares, with what the storages hold. */
export const getTavernIngredients = (
  type: OrdinaryTroopType, summary: SettlementTavernSummary,
  resources: Readonly<Record<string, number>> = {}, i18n?: I18n
) => [
  { ...getIngredient("settler", displayJobName("Settler", i18n), 1, summary.freeSettlers, i18n), ware: null },
  ...Object.entries(TAVERN_RECIPES[type]).map(([ware, need]) => ({
    ...getIngredient(ware, displayWareName(ware, i18n), need, resources[ware] ?? 0, i18n), ware
  }))
];

export type TavernIngredient = ReturnType<typeof getTavernIngredients>[number];

export const getTavernOrder = ({ count, type }: TavernDraft, nation: string, i18n?: I18n) => ({
  count: String(count),
  decreaseDisabled: count <= 1,
  increaseDisabled: count >= MAX_TAVERN_ORDER,
  submit: translateMessage(i18n, M.details.tavern.recruitCount, { count }),
  submitLabel: translateMessage(i18n, M.details.tavern.recruitCountLabel, {
    count, troop: troopPluralName(nation, type).toLowerCase()
  }),
  type
});

/** The current recruit and the waiting orders, or that nothing is ordered. */
export const getTavernQueueText = (
  summary: SettlementTavernSummary, nation: string, i18n?: I18n
) => {
  if (!summary.current) return translateMessage(i18n, M.details.tavern.noneOrdered);
  const current = translateMessage(i18n, M.details.tavern.current, {
    stage: translateMessage(i18n, STAGE_LABELS[summary.current.stage]),
    troop: troopName(nation, summary.current.type)
  });
  const waiting = summary.queue.map(order => translateMessage(i18n, M.details.tavern.waiting, {
    count: order.count, troop: troopName(nation, order.type)
  })).join(", ");
  return translateMessage(i18n, M.details.tavern.queue, { current, waiting });
};

export interface TavernScheduleEntry {
  count: number;
  key: string;
  label: string;
  portrait: string;
  stage?: string;
  type: MilitaryTroopType;
}

/**
 * The panel's scheduled-recruits box: the recruit being collected/equipped (or the first order
 * waiting for an innkeeper) and the batches behind it. The simulation's queue is the source; this
 * only gives the UI stable rows and localized labels.
 */
export const getTavernSchedule = (
  summary: SettlementTavernSummary, nation: string, i18n?: I18n
) => {
  const active = summary.queue[0];
  const stage = summary.current
    ? translateMessage(i18n, STAGE_LABELS[summary.current.stage])
    : translateMessage(i18n, M.details.tavern.stageWaiting);
  const type = summary.current?.type ?? active?.type;
  const currentOrder = summary.current?.type === active?.type ? active : undefined;
  const count = currentOrder?.count ?? (!summary.current ? active?.count : undefined) ?? 1;
  const current: TavernScheduleEntry | null = type ? {
    count,
    key: `current-${type}`,
    label: translateMessage(i18n, M.details.tavern.scheduleCurrent, {
      count, stage, troop: troopName(nation, type)
    }),
    portrait: troopPortrait(nation, type),
    stage,
    type
  } : null;
  // The first order is the active one only when its troop still matches the running batch;
  // a snapshot may also expose the current batch and the waiting orders separately.
  let firstWaiting = 0;
  if (summary.current) firstWaiting = active?.type === summary.current.type ? 1 : 0;
  else if (active) firstWaiting = 1;
  const waiting = summary.queue.slice(firstWaiting).map((order, index): TavernScheduleEntry => ({
    count: order.count,
    key: `waiting-${order.type}-${index}`,
    label: translateMessage(i18n, M.details.tavern.scheduleEntry, {
      count: order.count, troop: troopName(nation, order.type)
    }),
    portrait: troopPortrait(nation, order.type),
    type: order.type
  }));
  const queued = summary.queue.reduce((count, order) => count + order.count, 0);
  const total = summary.current && currentOrder === undefined ? queued + 1 : queued;
  return { current, total, waiting };
};
