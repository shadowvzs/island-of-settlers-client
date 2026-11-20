import { useLingui } from "@lingui/react";
import { useMemo } from "react";

import { useExternalStore } from "../../components/external-store";
import { getRewardIconsView } from "../../settlement-ui/reward-icons/helpers";
import { MAP_RULE_FEATURES, START_SUMMARY_ICONS } from "./constants";
import { editorGameSettings, editorSettingsStatus } from "./editor-game-settings";
import { useFactionAi } from "./faction-ai/use-faction-ai";
import { validationLines } from "./faction-ai/view-model";
import { startSetupEntries } from "./helpers";
import type { MapRulesControls } from "./map-rules-controls";
import { mapRewardsShown, mapRulesView } from "./view-model";

/** The section's view model and callbacks; re-built only when the scenario copy, settings or locale change. */
export const useMapRules = (controls: MapRulesControls) => {
  const { i18n } = useLingui();
  const state = useExternalStore(controls.state);
  const settings = useExternalStore(editorGameSettings);
  const status = useExternalStore(editorSettingsStatus);
  const view = useMemo(() => mapRulesView(i18n, state, settings, status), [i18n, settings, state, status]);
  const entries = useMemo(() => startSetupEntries(state), [state]);
  const summary = useMemo(() => getRewardIconsView(entries, { i18n, maxItems: START_SUMMARY_ICONS,
    nation: state.nation }), [entries, i18n, state.nation]);
  const factionAi = useFactionAi(controls.factionAi);
  const validation = useMemo(() => validationLines(view.warnings, factionAi.issues),
    [factionAi.issues, view.warnings]);
  return {
    ...view,
    entries,
    factionAi,
    nation: state.nation,
    onFeatureToggle: (id: string) => {
      const key = MAP_RULE_FEATURES.find(feature => feature === id);
      if (key) controls.toggleFeature(key);
    },
    onLevelCommit: controls.setFixedLevel,
    onNationDefault: controls.resetStock,
    onProgressionToggle: (id: string) => {
      if (id === "catchUp") controls.toggleCatchUp();
      else controls.toggleFlag(id as "experience" | "talents");
    },
    onStartEntriesChange: controls.setStartEntries,
    onStartSetupToggle: controls.toggleStartSetup,
    summary,
    validation
  };
};

export type MapRulesSectionView = ReturnType<typeof useMapRules>;

/** Map rewards (coins, claim and expiry times) show only when the game pays rewards home (owner Q2, rev H10). */
export const useMapRewardsShown = (kind: string) => mapRewardsShown(kind, useExternalStore(editorGameSettings));
