import { setupI18n } from "@lingui/core";
import { describe, expect, it, vi } from "vitest";

import { BuildingType } from "../../island-of-settlers-shared/src/building-types";
import type { BuildingAvailability } from "../../island-of-settlers-shared/src/game-settings/building-availability";
import { createBuildingAvailabilityControls } from
  "../src/app/map-editor/building-availability/building-availability-controls";
import { withBanToggled, withTier } from "../src/app/map-editor/building-availability/helpers";
import {
  canCapLevel, ineffectiveLevelCaps, withLevelCapCycled
} from "../src/app/map-editor/building-availability/level-caps";
import { buildingAvailabilityView } from "../src/app/map-editor/building-availability/view-model";
import { createSettlementCommandActions } from "../src/app/settlement/settlement-ui-actions";
import { getHomeSandboxButton } from "../src/app/settlement-ui/main-panel/build-helpers";
import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { buildingUnlockLevel } from "../src/shared/progression/building-unlocks";
import { withHomeSandbox } from "../src/shared/settlement/building-availability-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { createMapScenario, type MapScenario } from "../src/shared/world/map-scenario";
import { huntingWorld } from "./helpers/hunting-world";

const WOODCUTTER = BuildingType.Woodcutter;
const SAWMILL = BuildingType.Sawmill;

const island = (scenario?: Partial<MapScenario>) => {
  const world = huntingWorld();
  if (scenario) world.scenario = { ...createMapScenario(), ...scenario };
  return createSettlementSimulation({ world, roads: createRoadNetwork(world), initialSettlers: 8, homeBuilding: 0,
    initialStock: {}, canWorkerEnterPlot: () => true, playerLevel: () => 1 });
};

const commandActions = (simulation: ReturnType<typeof island>) => {
  const message = vi.fn();
  const actions = createSettlementCommandActions({ message, onBuildingDemolished: () => {}, simulation,
    updateUi: () => {} });
  return { actions, message };
};

describe("home sandbox control", () => {
  it("switches only the unlock and keeps the player's other home rules", () => {
    expect(withHomeSandbox(undefined, true)).toEqual({ unlockAll: true });
    expect(withHomeSandbox({ banned: [WOODCUTTER], unlockAll: true }, false)).toEqual({ banned: [WOODCUTTER] });
    expect(withHomeSandbox({ tier: 3 }, true)).toEqual({ tier: 3, unlockAll: true });
  });

  it("opens every level gate on the home island through the recorded command, and back", () => {
    const simulation = island();
    const locked = BUILDING_CATALOG.find(entry => buildingUnlockLevel(entry.id) > 1 &&
      simulation.buildingLockLevel(entry.id) !== null)!;
    const { actions, message } = commandActions(simulation);
    expect(actions.onHomeSandbox!(true)).toBe(true);
    expect(simulation.homeBuildingRules()).toEqual({ unlockAll: true });
    expect(simulation.buildingLockLevel(locked.id)).toBeNull();
    expect(message).toHaveBeenLastCalledWith(expect.stringContaining("Home sandbox on"));
    expect(actions.onHomeSandbox!(false)).toBe(true);
    expect(simulation.homeBuildingRules()).toBeUndefined();
    expect(simulation.buildingLockLevel(locked.id)).not.toBeNull();
  });

  it("is refused off the home island and absent from its build view", () => {
    const { actions, message } = commandActions(island({ kind: "colony" }));
    expect(actions.onHomeSandbox!(true)).toBe(false);
    expect(message).toHaveBeenLastCalledWith(expect.stringMatching(/home island/), true);
    expect(getHomeSandboxButton(undefined)).toBeNull();
    expect(getHomeSandboxButton(false)).toMatchObject({ label: "Home sandbox", pressed: false });
    expect(getHomeSandboxButton(true)?.title).toMatch(/normal level progression/);
  });
});

describe("editor level caps", () => {
  const capOf = (rules: BuildingAvailability, type: number) => rules.levelCaps?.find(cap => cap.type === type)?.level;

  it("cycle below the tier: none → tier − 1 → … → 1 → none", () => {
    let rules: BuildingAvailability = { tier: 3 };
    const seen: (number | undefined)[] = [];
    for (let click = 0; click < 3; click++) {
      rules = withLevelCapCycled(rules, SAWMILL);
      seen.push(capOf(rules, SAWMILL));
    }
    expect(seen).toEqual([2, 1, undefined]);
    expect(canCapLevel({ tier: 1 }, SAWMILL)).toBe(false);
    expect(canCapLevel({ banned: [SAWMILL] }, SAWMILL)).toBe(false);
  });

  it("stay consistent with the tier and the bans", () => {
    const capped = withLevelCapCycled(withLevelCapCycled(withLevelCapCycled({}, SAWMILL), SAWMILL), WOODCUTTER);
    expect(capped.levelCaps).toEqual([{ level: 4, type: WOODCUTTER }, { level: 3, type: SAWMILL }].sort((first,
      second) => first.type - second.type));
    expect(withTier(capped, 4).levelCaps).toEqual([{ level: 3, type: SAWMILL }]);
    expect(capOf(withBanToggled(capped, SAWMILL), SAWMILL)).toBeUndefined();
    expect(ineffectiveLevelCaps({ banned: [SAWMILL], levelCaps: [{ level: 3, type: WOODCUTTER },
      { level: 2, type: SAWMILL }], tier: 3 })).toEqual([WOODCUTTER, SAWMILL]);
  });

  it("edit the scenario as one undo step, skipping clicks that change nothing", () => {
    const scenario = { ...createMapScenario(), availability: { tier: 1 } };
    const edit = vi.fn((change: (value: MapScenario) => void | false) => change(scenario));
    const controls = createBuildingAvailabilityControls({ edit, scenario: () => scenario, world: () => undefined });
    controls.cycleLevelCap(SAWMILL);
    expect(edit.mock.results[0]!.value).toBe(false);
    controls.setTier(3);
    controls.cycleLevelCap(SAWMILL);
    expect(scenario.availability).toEqual({ levelCaps: [{ level: 2, type: SAWMILL }], tier: 3 });
  });

  it("show the cap badge and the mode's own tooltips", () => {
    const i18n = setupI18n({ locale: "en", messages: { en: {} } });
    const state = { availability: { levelCaps: [{ level: 2, type: SAWMILL }], tier: 4 }, materialIssues: [],
      nation: "roman" as const };
    const capView = buildingAvailabilityView(i18n, state, "cap");
    const sawmill = capView.bans.find(entry => entry.id === SAWMILL)!;
    expect(sawmill).toMatchObject({ capText: "≤2", pressed: false });
    expect(sawmill.label).toMatch(/highest level 2/);
    expect(capView.modes.map(mode => mode.pressed)).toEqual([false, true]);
    expect(buildingAvailabilityView(i18n, state, "ban").bans.find(entry => entry.id === SAWMILL)!.label)
      .toMatch(/click to ban/);
  });
});
