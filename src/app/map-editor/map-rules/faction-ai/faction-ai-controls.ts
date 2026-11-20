import { createMapScenario, type MapScenario } from "../../../../shared/world/map-scenario";
import type { FactionAiMode, FactionAiStyle, ScenarioFactionAi } from "../../../../shared/world/scenario-faction-ai";
import type { FactionAiCheckContext } from "../../../../shared/world/scenario-faction-ai-issues";
import { createExternalStore, isDeepEqual } from "../../../components/ui-store";
import type { RewardEntry } from "../../../settlement-ui/reward-icons/entries";
import type { FactionAiBonusKey, FactionAiLimitKey } from "./constants";
import {
  applyFactionAi, nextFreeFaction, toFactionAiState, withFactionBonus, withFactionLevel, withFactionLimit,
  withFactionMode, withFactionStart, withFactionStyle
} from "./helpers";

interface FactionAiControlsOptions {
  /** The map's cells for the map-size warning; absent skips it. */
  cells?: () => FactionAiCheckContext;
  /** The scenario editor's one undoable edit. */
  edit: (change: (scenario: MapScenario) => void | false) => void;
  scenario: () => MapScenario | undefined;
}

type EntriesChange = (entries: readonly ScenarioFactionAi[]) => ScenarioFactionAi[];

/**
 * The Computer factions rows' controller (enemy economy AI plan §2.3): a published copy of the rows and their issues,
 * and the edits, each one undoable step. Added rows are session drafts until their mode is not `none`.
 */
export const createFactionAiControls = ({ cells, edit, scenario }: FactionAiControlsOptions) => {
  const addedFactions: number[] = [];
  const read = () => toFactionAiState(scenario() ?? createMapScenario(), cells?.(), addedFactions);
  const state = createExternalStore(read());
  const refresh = () => {
    const next = read();
    if (!isDeepEqual(next, state.getSnapshot())) state.set(next);
  };
  /** A home map is peaceful (the guard refuses AI there); an edit that changes nothing is no undo step. */
  const editEntries = (change: EntriesChange) => edit(value => {
    const current = value.factionAi ?? [], next = change(current);
    if (value.kind === "home" || isDeepEqual(next, current)) return false;
    applyFactionAi(value, next);
  });
  return {
    addFaction: () => {
      const faction = nextFreeFaction(state.getSnapshot().factions);
      if (faction === undefined) return;
      addedFactions.push(faction);
      refresh();
    },
    refresh,
    setBonus: (faction: number, key: FactionAiBonusKey, text: string) =>
      editEntries(entries => withFactionBonus(entries, faction, key, text)),
    setLevel: (faction: number, value: string) => editEntries(entries => withFactionLevel(entries, faction, value)),
    setLimit: (faction: number, key: FactionAiLimitKey, text: string) =>
      editEntries(entries => withFactionLimit(entries, faction, key, text)),
    setMode: (faction: number, mode: FactionAiMode) => editEntries(entries => withFactionMode(entries, faction, mode)),
    setStart: (faction: number, pickerEntries: RewardEntry[]) =>
      editEntries(entries => withFactionStart(entries, faction, pickerEntries)),
    setStyle: (faction: number, style: FactionAiStyle) =>
      editEntries(entries => withFactionStyle(entries, faction, style)),
    state
  };
};

export type FactionAiControls = ReturnType<typeof createFactionAiControls>;
