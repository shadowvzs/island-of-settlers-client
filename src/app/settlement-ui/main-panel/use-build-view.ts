import { useLingui } from "@lingui/react";
import { useMemo, useState } from "react";

import { isRoadTier, type RoadTier } from "../../../shared/settlement/road-types";
import type { SurveyJob } from "../../../shared/settlement/settlement-surveying";
import { isShallowEqual } from "../../components/ui-store";
import { useStoreSelector } from "../../components/use-store-selector";
import type { SettlementRoadMode } from "../types";
import type { SettlementUiStore } from "../ui-store";
import {
  type BuildingCard, type BuildToolRow, getBuildingCardGroups, getBuildingLockText, getBuildToolRows,
  getCardLockNotice, getHighlightTabIndex, getHomeSandboxButton, getRoadCardRows, getRoadLockLevel,
  getSelectionDetail, isSurveyJob, selectBuildingPicker, selectBuildTools, selectHomeSandbox
} from "./build-helpers";
import type { MainPanelVisibilityStore } from "./main-panel";
import { useMainPanelView } from "./use-main-panel-view";

interface BuildViewActions {
  canSurvey: boolean;
  onHomeSandbox: (enabled: boolean) => void;
  onPickBuilding: (id: number) => void;
  onRoadTool: (mode: Exclude<SettlementRoadMode, null>) => void;
  onSurveyJob: (job: SurveyJob) => void;
}

/**
 * Road / survey tools and the picker's cards; computed only while the Build view is shown. A tap on a
 * locked card shows its level requirement under the cards instead of starting a placement (phones
 * have no hover title).
 */
export const useBuildView = (store: SettlementUiStore, panel: MainPanelVisibilityStore, actions: BuildViewActions) => {
  const { canSurvey, onHomeSandbox, onPickBuilding, onRoadTool, onSurveyJob } = actions;
  const { i18n } = useLingui();
  const active = useMainPanelView(panel, "build");
  const tools = useStoreSelector(store, selectBuildTools, isShallowEqual, active, i18n.locale);
  const picker = useStoreSelector(store, selectBuildingPicker, isShallowEqual, active, i18n.locale);
  const sandbox = useStoreSelector(store, selectHomeSandbox, Object.is, active);
  const [tappedLock, setTappedLock] = useState<number | null>(null);
  const [tappedRoad, setTappedRoad] = useState<RoadTier | null>(null);
  const roadRequirement = tappedRoad === null ? undefined : getRoadLockLevel(tappedRoad, tools.level);
  const roadNotice = roadRequirement === undefined
    ? null : getBuildingLockText(roadRequirement, tools.level, i18n);
  const lockNotice = useMemo(() => getCardLockNotice(picker, tappedLock, i18n), [i18n, picker, tappedLock]);
  return {
    detail: useMemo(() => getSelectionDetail(picker, roadNotice ?? lockNotice, i18n),
      [i18n, lockNotice, picker, roadNotice]),
    groups: useMemo(() => getBuildingCardGroups(picker, i18n), [i18n, picker]),
    homeSandbox: useMemo(() => getHomeSandboxButton(sandbox, i18n), [i18n, sandbox]),
    onHomeSandbox: () => onHomeSandbox(!sandbox),
    /** A new Build request remounts the tabs on the first highlighted building's category. */
    tabIndex: useMemo(() => getHighlightTabIndex(picker.highlight), [picker.highlight]),
    tabsKey: picker.highlightRevision,
    roads: useMemo(() => getRoadCardRows(tools, i18n), [i18n, tools]),
    tools: useMemo(() => getBuildToolRows(tools, canSurvey, i18n), [canSurvey, i18n, tools]),
    onPickCard: (card: BuildingCard) => {
      setTappedRoad(null);
      setTappedLock(card.locked ? card.id : null);
      if (!card.locked) onPickBuilding(card.id);
    },
    onTool: (id: BuildToolRow["id"]) => {
      setTappedLock(null);
      if (!isSurveyJob(id) && id !== "remove") {
        if (!isRoadTier(id)) {
          setTappedRoad(null);
          onRoadTool(id);
          return;
        }
        const required = getRoadLockLevel(id, tools.level);
        setTappedRoad(required === undefined ? null : id);
        if (required === undefined) onRoadTool(id);
        return;
      }
      setTappedRoad(null);
      if (isSurveyJob(id)) onSurveyJob(id);
      else onRoadTool(id);
    }
  };
};
