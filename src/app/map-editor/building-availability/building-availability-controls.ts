import type { BuildingAvailability } from
  "../../../../../island-of-settlers-shared/src/game-settings/building-availability";
import type { MapScenario } from "../../../shared/world/map-scenario";
import type { WorldData } from "../../../shared/world/world-data";
import { createExternalStore, isDeepEqual } from "../../components/ui-store";
import { applyAvailability, toBuildingAvailabilityState, withBanToggled, withTier } from "./helpers";
import { canCapLevel, withLevelCapCycled } from "./level-caps";

interface BuildingAvailabilityControlsOptions {
  /** The scenario editor's one undoable edit (seeds a new scenario on the first edit). */
  edit: (change: (scenario: MapScenario) => void | false) => void;
  scenario: () => MapScenario | undefined;
  world: () => Pick<WorldData, "colonyStoneDeposits" | "props"> | undefined;
}

/** The Building availability section's controller: a published copy of the rules, each edit one undo step. */
export const createBuildingAvailabilityControls = ({ edit, scenario, world }: BuildingAvailabilityControlsOptions) => {
  const state = createExternalStore(toBuildingAvailabilityState(scenario(), world()));
  /** One undo step; a change that returns false (nothing to edit) records none. */
  const editRules = (change: (rules: BuildingAvailability) => BuildingAvailability | false) => edit(value => {
    const next = change(value.availability ?? {});
    if (next === false) return false;
    applyAvailability(value, next);
  });
  return {
    cycleLevelCap: (typeId: number) =>
      editRules(rules => canCapLevel(rules, typeId) && withLevelCapCycled(rules, typeId)),
    refresh: () => {
      const next = toBuildingAvailabilityState(scenario(), world());
      if (!isDeepEqual(next, state.getSnapshot())) state.set(next);
    },
    setTier: (tier: number) => editRules(rules => withTier(rules, tier)),
    state,
    toggleBan: (typeId: number) => editRules(rules => withBanToggled(rules, typeId))
  };
};

export type BuildingAvailabilityControls = ReturnType<typeof createBuildingAvailabilityControls>;
