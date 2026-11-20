import type { SimFeatureKey } from "../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { createMapScenario, type MapScenario } from "../../../shared/world/map-scenario";
import type { FactionAiCheckContext } from "../../../shared/world/scenario-faction-ai-issues";
import type { MapRules } from "../../../shared/world/scenario-map-rules";
import { createExternalStore, isDeepEqual } from "../../components/ui-store";
import type { RewardEntry } from "../../settlement-ui/reward-icons/entries";
import { createFactionAiControls } from "./faction-ai/faction-ai-controls";
import {
  allowsCatchUpSkip, allowsFixedLevel, applyMapRules, applyStartSetup, type MapRuleFlag, startSetupFromEntries,
  toMapRulesState, withCatchUpToggled, withFeatureToggled, withFixedLevel, withFlagToggled
} from "./helpers";

interface MapRulesControlsOptions {
  /** The map's cells (the faction AI map-size warning); absent skips that warning. */
  cells?: () => FactionAiCheckContext;
  /** The scenario editor's one undoable edit (seeds a new scenario on the first edit). */
  edit: (change: (scenario: MapScenario) => void | false) => void;
  scenario: () => MapScenario | undefined;
}

/**
 * The Map rules section's controller (GS-MAP): a published copy of the scenario's start setup and rules, and the
 * edits, each one undoable step through the scenario editor.
 */
export const createMapRulesControls = ({ cells, edit, scenario }: MapRulesControlsOptions) => {
  const state = createExternalStore(toMapRulesState(scenario() ?? createMapScenario()));
  const factionAi = createFactionAiControls({ cells, edit, scenario });
  /** A rule edit the map kind forbids is refused (the scenario guard would reject the file). */
  const editRules = (
    change: (rules: MapRules) => MapRules, allowed: (kind: MapScenario["kind"]) => boolean = () => true
  ) =>
    edit(value => {
      if (!allowed(value.kind)) return false;
      applyMapRules(value, change(value.rules ?? {}));
    });
  return {
    factionAi,
    refresh: () => {
      const next = toMapRulesState(scenario() ?? createMapScenario());
      if (!isDeepEqual(next, state.getSnapshot())) state.set(next);
      factionAi.refresh();
    },
    resetStock: () => edit(value => { value.stock = {}; }),
    setFixedLevel: (text: string) => editRules(rules => withFixedLevel(rules, text), allowsFixedLevel),
    setStartEntries: (entries: RewardEntry[]) =>
      edit(value => applyStartSetup(value, startSetupFromEntries(entries, value.nation))),
    state,
    toggleCatchUp: () => editRules(withCatchUpToggled, allowsCatchUpSkip),
    toggleFeature: (key: SimFeatureKey) => editRules(rules => withFeatureToggled(rules, key)),
    toggleFlag: (flag: MapRuleFlag) => editRules(rules => withFlagToggled(rules, flag)),
    toggleStartSetup: () => edit(value => {
      if (value.kind !== "campaign") return false;
      if (value.startSetup === "off") delete value.startSetup;
      else value.startSetup = "off";
    })
  };
};

export type MapRulesControls = ReturnType<typeof createMapRulesControls>;
