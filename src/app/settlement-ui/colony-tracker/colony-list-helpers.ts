import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { isAdventureIsland } from "../../../shared/settlement/adventure-rules";
import type { ColonyExpeditionSnapshot } from "../../../shared/settlement/settlement-colony-expeditions";
import type { CommanderSnapshot } from "../../../shared/settlement/settlement-commander";
import { joinDetails } from "../../components/helpers";
import { troopPortrait, troopTypes } from "../../settlement/army-icons";
import { troopName } from "../../settlement/troop-names";
import { adventureArt, type ArtImage, settlementIconArt, wareArt } from "../art-helpers";
import { adventureRecordLabel, colonyRecordLabel, formatColonyDuration, getColonyDifficultyName } from "../colony-helpers";
import { formatWareCount } from "../helpers";
import { islandClimateLabel } from "../island-climate-label";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementPopupContent } from "../settlement-popup";
import type { SettlementAdventureSummary, SettlementColonySummary, SettlementUiOptions } from "../types";
import type { ColonyTrackerSlice } from "./helpers";

type IslandSummary = SettlementColonySummary | SettlementAdventureSummary;
type ListOptions = Pick<SettlementUiOptions,
  "onDisbandColony" | "onRecallColonySoldiers" | "onReturnCommander" | "onReturnHome" | "onVisitColony">;

/** One icon button of a row; `data` carries the attributes the drivers query (`data-colony-visit`, …). */
export interface ColonyRowAction {
  className: string;
  current?: "location";
  data?: Readonly<Record<`data-${string}`, string>>;
  disabled?: boolean;
  icon: string;
  key: string;
  label: string;
  onSelect: () => void;
}

/** Disband / abandon confirmation shown in the settlement popup. */
export const getDisbandConfirmation = (
  island: IslandSummary, adventure: boolean, onDisband?: (id: number) => void, i18n?: I18n
): SettlementPopupContent => ({
  actions: [
    { icon: "cancel", label: translateMessage(i18n, adventure ? M.colony.abandon : M.colony.disband),
      onSelect: () => onDisband?.(island.id), primary: true },
    { icon: "ship", label: translateMessage(i18n, adventure ? M.colony.keepFighting : M.colony.keepColony) }
  ],
  message: translateMessage(i18n, adventure ? M.colony.abandonMessage : M.colony.disbandMessage,
    { island: island.island.name }),
  title: translateMessage(i18n, adventure ? M.colony.abandonQuestion : M.colony.disbandQuestion,
    { island: island.island.name }),
  tone: "question"
});

const visitAction = (
  island: IslandSummary, active: number | null, adventure: boolean, options: ListOptions, i18n?: I18n
) => {
  const here = island.id === active;
  const dataKey = adventure ? "data-adventure-visit" : "data-colony-visit";
  return {
    className: "colony-tracker__visit", current: here ? "location" as const : undefined,
    data: { [dataKey]: String(island.id) }, disabled: here || !options.onVisitColony, icon: here ? "map" : "ship",
    key: "visit",
    label: translateMessage(i18n, here ? M.colony.youAreHere : M.colony.visit, {
      island: island.island.name
    }),
    onSelect: () => options.onVisitColony?.(island.id)
  };
};

const recallAction = (
  colony: SettlementColonySummary, options: ListOptions, i18n?: I18n
): ColonyRowAction => ({
  className: "colony-tracker__visit", data: { "data-colony-recall": String(colony.id) },
  disabled: colony.troopRecallPending === true || !options.onRecallColonySoldiers, icon: "ship", key: "recall",
  label: colony.troopRecallPending
    ? colony.troopRecallStatus ?? translateMessage(i18n, M.colony.recallPending)
    : translateMessage(i18n, M.colony.recall),
  onSelect: () => options.onRecallColonySoldiers?.(colony.id)
});

const canRecall = (colony: SettlementColonySummary) =>
  Boolean(colony.recallableSoldiers ?? colony.soldiers ?? 0) || Boolean(colony.troopRecallPending);

/** Return a deployed commander through the real naval pickup (or the adventure's landing ship). */
const returnCommanderAction = (
  commander: CommanderSnapshot | undefined, options: ListOptions, i18n?: I18n
): ColonyRowAction | null => {
  if (!commander || !options.onReturnCommander) return null;
  const pending = commander.transport?.phase === "returning";
  let label = commander.blockDetail ?? translateMessage(i18n, M.colony.returnCommander);
  if (pending) label = translateMessage(i18n, M.colony.returnCommanderPending);
  else if (commander.canReturn) label = translateMessage(i18n, M.colony.returnCommander);
  return {
    className: "colony-tracker__visit", data: { "data-commander-return": "1" },
    disabled: !commander.canReturn || pending,
    icon: "ship", key: "commander", label,
    onSelect: () => options.onReturnCommander?.()
  };
};

/** Visit (or "you are here"), recall on the visited colony, and disband / abandon behind a confirmation. */
const islandActions = (
  island: IslandSummary, active: number | null, adventure: boolean, options: ListOptions,
  confirm: (popup: SettlementPopupContent) => void, commander: CommanderSnapshot | undefined, i18n?: I18n
): ColonyRowAction[] => {
  const disband = options.onDisbandColony ? [{
    className: "colony-tracker__disband", icon: "cancel", key: "disband",
    label: translateMessage(i18n, adventure ? M.colony.abandonAction : M.colony.disbandAction,
      { island: island.island.name }),
    onSelect: () => confirm(getDisbandConfirmation(island, adventure, options.onDisbandColony, i18n))
  }] : [];
  if (island.id !== active)
    return [visitAction(island, active, adventure, options, i18n), ...disband];
  const returnCommander = returnCommanderAction(commander, options, i18n);
  const commanderActions = returnCommander ? [returnCommander] : [];
  if (adventure) return [...commanderActions, ...disband];
  const colony = island as SettlementColonySummary;
  if (!canRecall(colony)) return [...commanderActions, ...disband];
  return [recallAction(colony, options, i18n), ...commanderActions, ...disband];
};

// The name has the title line to itself; the difficulty leads the status line.
const detailOf = ({ island }: IslandSummary, label: string, i18n?: I18n) =>
  joinDetails(getColonyDifficultyName(island.difficulty, i18n), islandClimateLabel(island, i18n), label);

const returnLabel = (
  expeditions: readonly ColonyExpeditionSnapshot[], id: number, i18n?: I18n
) => {
  const voyage = expeditions.find(entry => entry.id === id && entry.returningShips);
  if (!voyage) return "";
  return translateMessage(i18n, M.colony.returningFrom, {
    target: translateMessage(i18n, isAdventureIsland(voyage.island)
      ? M.colony.adventureKind : M.colony.colonyKind).toLowerCase()
  });
};

const hereLabel = (id: number, active: number | null, i18n?: I18n) =>
  id === active ? translateMessage(i18n, M.colony.here) : "";

/** The visited conquered colony's next resource ship: arrival, collection or the scheduled pickup. */
const resourceSchedule = (
  colony: SettlementColonySummary, active: number | null, now: number, i18n?: I18n
) => {
  if (colony.id !== active || colony.status !== "conquered") return undefined;
  const eta = colony.resourceShipArrivalSeconds;
  if (eta !== undefined) return {
    text: eta > 0
      ? translateMessage(i18n, M.colony.resourceArrives, { time: formatColonyDuration(eta, i18n) })
      : translateMessage(i18n, M.colony.resourceCollecting)
  };
  if (colony.nextResourceShipAt === undefined) return undefined;
  const left = Math.max(0, (colony.nextResourceShipAt - now) / 1000);
  return {
    text: translateMessage(i18n, M.colony.resourceNext, { time: formatColonyDuration(left, i18n) }),
    title: translateMessage(i18n, M.colony.resourceEarlier)
  };
};

const incomingStatus = (
  ship: NonNullable<SettlementColonySummary["incomingShips"]>[number], i18n?: I18n
) => {
  if (ship.status === "unloading") return translateMessage(i18n, M.colony.incomingUnloading);
  if (ship.arrivalSeconds === undefined) return translateMessage(i18n, M.colony.incomingWaiting);
  return translateMessage(i18n, M.colony.incomingArrives, {
    time: formatColonyDuration(ship.arrivalSeconds, i18n)
  });
};

/** Incoming ship bubbles: name, arrival and the cargo (wares, then troops per type). */
export const getIncomingShips = (
  ships: SettlementColonySummary["incomingShips"], nation: string, i18n?: I18n
) => (ships ?? []).map(ship => ({
    cargo: [
      ...Object.entries(ship.wares ?? {}).filter(([, count]) => count > 0)
        .map(([ware, count]) => ({ art: wareArt(ware) as ArtImage, count, label: formatWareCount(count, ware) })),
      ...troopTypes.filter(type => ship.troops?.[type])
        .map(type => ({ art: { kind: "image", source: troopPortrait(nation, type) } as ArtImage,
          count: ship.troops![type]!, label: `${troopName(nation, type)}: ${ship.troops![type]}` }))
    ],
    eta: incomingStatus(ship, i18n),
    id: ship.id,
    name: ship.name
  }));

const colonyRow = (
  colony: SettlementColonySummary, slice: ColonyTrackerSlice, now: number, options: ListOptions,
  confirm: (popup: SettlementPopupContent) => void, i18n?: I18n
) => {
  const recall = colony.troopRecallStatus ? ` · ${colony.troopRecallStatus}` : "";
  const label = `${colonyRecordLabel(colony, now, i18n)}${recall}` +
    returnLabel(slice.expeditions, colony.id, i18n) + hereLabel(colony.id, slice.active, i18n);
  return {
    actions: islandActions(colony, slice.active, false, options, confirm, slice.commanders[0], i18n),
    art: wareArt(colony.island.ore),
    detail: detailOf(colony, label, i18n),
    incoming: getIncomingShips(colony.incomingShips, slice.nation, i18n),
    key: `colony-${colony.id}`, schedule: resourceSchedule(colony, slice.active, now, i18n),
    title: translateMessage(i18n, M.colony.colonyTitle, { island: colony.island.name })
  };
};

const adventureRow = (
  adventure: SettlementAdventureSummary, slice: ColonyTrackerSlice, options: ListOptions,
  confirm: (popup: SettlementPopupContent) => void, i18n?: I18n
) => ({
  actions: islandActions(adventure, slice.active, true, options, confirm, slice.commanders[0], i18n),
  art: adventureArt(slice.nation),
  detail: detailOf(adventure, adventureRecordLabel(adventure, i18n) +
    `${returnLabel(slice.expeditions, adventure.id, i18n)}${hereLabel(adventure.id, slice.active, i18n)}`, i18n),
  incoming: [], key: `adventure-${adventure.id}`, schedule: undefined,
  title: translateMessage(i18n, M.colony.adventureTitle, { island: adventure.island.name })
});

const homeAction = (options: ListOptions, i18n?: I18n): ColonyRowAction => ({
  className: "colony-tracker__visit", icon: "ship", key: "home",
  label: translateMessage(i18n, M.colony.returnHome),
  onSelect: () => options.onReturnHome?.()
});

const homeRow = (options: ListOptions, i18n?: I18n) => ({
  actions: [homeAction(options, i18n)], art: settlementIconArt("warehouse"),
  detail: translateMessage(i18n, M.colony.mainSettlement), incoming: [],
  key: "home", schedule: undefined, title: translateMessage(i18n, M.colony.homeIsland)
});

/** Colonies: island, ore icon, status and travel; adventures; the home island while abroad. */
export const getColonyRows = (
  slice: ColonyTrackerSlice, now: number, options: ListOptions,
  confirm: (popup: SettlementPopupContent) => void, i18n?: I18n
) => [
  ...(slice.active !== null && options.onReturnHome ? [homeRow(options, i18n)] : []),
  ...slice.colonies.map(colony => colonyRow(colony, slice, now, options, confirm, i18n)),
  ...slice.adventures.map(adventure => adventureRow(adventure, slice, options, confirm, i18n))
];

export type ColonyRowView = ReturnType<typeof getColonyRows>[number];
