import { useLingui } from "@lingui/react";
import { useMemo, useState } from "react";

import type { ColonyTroops } from "../../../shared/settlement/colony-expedition-rules";
import type { MilitaryTroopType } from "../../../shared/settlement/military-combat-rules";
import { type ExternalStore, useExternalStore } from "../../components/external-store";
import { isShallowEqual } from "../../components/ui-store";
import { useCommandStatus } from "../../components/use-command-status";
import { useStoreSelector } from "../../components/use-store-selector";
import { fitColonyTroops } from "../colony-helpers";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementWindowVisibilityStore } from "../react-window";
import type { SettlementUiOptions } from "../types";
import type { SettlementUiStore } from "../ui-store";
import {
  canStartExpedition, commanderLaunchReason,
EMPTY_TROOPS,   findSelectedCommander, getCommanderCards, getCommanderSummary, getEstimateLabel, getIslandCards, getPlannerDetails, getThreatLabel,
  getTotalLabel, getTroopRows, planExpedition, type PlannerKind, resolvePlannerIsland, selectPlanner,
  setPlannerTroop, startExpedition
} from "./helpers";

export interface ExpeditionPlannerContext {
  close: () => void;
  /** The harbour the planner was opened for (`openFor`). */
  harbour: ExternalStore<number>;
  kind: PlannerKind;
  options: SettlementUiOptions;
  store: SettlementUiStore;
  visibility: SettlementWindowVisibilityStore;
}

/**
 * Island choice, troop draft and the synchronous plan. The troop draft survives closing (reset only after
 * a successful start); the status clears on every `openFor`; the plan is recomputed on each change and
 * snapshot while the planner is shown.
 */
export const useExpeditionPlanner = ({
  close, harbour, kind, options, store, visibility
}: ExpeditionPlannerContext) => {
  const { i18n } = useLingui();
  const { opened, visible } = useExternalStore(visibility);
  const source = useExternalStore(harbour);
  const select = useMemo(() => selectPlanner(kind, source, i18n), [i18n, kind, source]);
  const slice = useStoreSelector(store, select, isShallowEqual, visible, i18n.locale);
  const [chosen, setChosen] = useState<number | null>(null);
  const [draft, setDraft] = useState<ColonyTroops>(EMPTY_TROOPS);
  const [commanderId, setCommanderId] = useState<string | null>(null);
  const { report, status } = useCommandStatus("", opened);
  const island = resolvePlannerIsland(slice.islands, chosen);
  const chosenIsland = slice.islands.find(entry => entry.id === island);
  const difficulty = chosenIsland?.difficulty ?? "easy";
  const troops = useMemo(() => fitColonyTroops(draft, difficulty), [draft, difficulty]);
  const selectedCommander = findSelectedCommander(slice.commanders, commanderId);
  const commanderReason = commanderLaunchReason(slice.commanders, commanderId, i18n);
  // A new snapshot can change the plan's ships/loads even when island and troops are unchanged.
  const plan = useMemo(() => planExpedition(kind, options, source, island, troops, commanderId ?? undefined),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [commanderId, island, kind, options, slice, source, troops]);
  return {
    commanderCards: useMemo(() => getCommanderCards(slice.commanders, commanderId, i18n),
      [commanderId, i18n, slice.commanders]),
    commanderSummary: getCommanderSummary(selectedCommander, i18n),
    details: useMemo(() => getPlannerDetails(kind, options, chosenIsland, i18n),
      [chosenIsland, i18n, kind, options]),
    estimate: getEstimateLabel(plan, i18n),
    islands: useMemo(() => getIslandCards(slice.islands, island, slice.nation, slice.sailing, i18n),
      [i18n, island, slice]),
    startTitle: slice.blocked ?? commanderReason ?? plan?.commanderReason ?? plan?.launchReason ??
      i18n._(M.planner.startTitle),
    startDisabled: !canStartExpedition(troops, plan, island, slice.blocked, commanderReason),
    status: slice.blocked ?? commanderReason ?? status,
    threat: getThreatLabel(chosenIsland, i18n),
    total: getTotalLabel(troops, difficulty, i18n),
    troops: useMemo(() => getTroopRows(troops, slice.available, slice.nation, i18n),
      [i18n, slice, troops]),
    onChooseCommander: setCommanderId,
    onChooseIsland: setChosen,
    onStart: () => {
      if (!canStartExpedition(troops, plan, island, slice.blocked, commanderReason) || island === null) return;
      const result = startExpedition(kind, options, source, island, troops,
        commanderId ?? undefined, i18n);
      if (result !== true) { report(result); return; }
      setDraft(EMPTY_TROOPS);
      setCommanderId(null);
      close();
    },
    onTroopChange: (type: MilitaryTroopType, value: number) =>
      setDraft(setPlannerTroop(troops, type, value, difficulty, slice.available))
  };
};

export type ExpeditionPlannerView = ReturnType<typeof useExpeditionPlanner>;
