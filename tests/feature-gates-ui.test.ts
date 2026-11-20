import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { WorldSection } from "../src/app/settings/sections/world-section";
import { unsettledHarbourSpots } from "../src/app/settlement/fog-off-harbour-markers";
import { getPlannerButtons, getScoutingView } from "../src/app/settlement-ui/building-details/harbour-helpers";
import { selectBuildingDetails } from "../src/app/settlement-ui/building-details/helpers";
import { getFeatureGate } from "../src/app/settlement-ui/feature-gate";
import { getFleetSections, selectFleet } from "../src/app/settlement-ui/fleet/helpers";
import type { SettlementUiSnapshot } from "../src/app/settlement-ui/types";
import type { FeatureStates } from "../src/shared/settlement/feature-rules";
import { BLOCKING, type WorldData } from "../src/shared/world/world-data";
import { renderWithI18n } from "./helpers/render-with-i18n";

/** GS4a: entries hide while the game switches a feature off and show disabled where the map narrows it. */

const ALL_ON: FeatureStates = {
  adventures: "on", colonies: "on", explorationExpeditions: "on", settlementExpeditions: "on", trade: "on"
};
const MAP_OFF = "Not available on this island";
const harbours = [{ completed: true, id: "3", type: 39 }] as SettlementUiSnapshot["buildings"];
const harbourDetails = (features: FeatureStates) => selectBuildingDetails({
  buildings: harbours, colonyIslands: [], features, focusedBuilding: "3"
} as SettlementUiSnapshot);

describe("feature gates in the settlement UI", () => {
  it("maps a feature state to hidden or a disabled reason", () => {
    expect(getFeatureGate("on")).toEqual({ hidden: false, reason: undefined });
    expect(getFeatureGate(undefined)).toEqual({ hidden: false, reason: undefined });
    expect(getFeatureGate("gameOff")).toEqual({ hidden: true, reason: undefined });
    expect(getFeatureGate("mapOff")).toEqual({ hidden: false, reason: MAP_OFF });
  });

  it("hides or disables the harbour's colony and adventure planners and explains the exploring refusal", () => {
    const off = getPlannerButtons(false, true, true, harbourDetails({ ...ALL_ON, adventures: "gameOff",
      colonies: "mapOff" }));
    expect(off).toMatchObject({ colonyDisabled: true, colonyTitle: MAP_OFF, hideAdventure: true, hideColony: false });
    const on = getPlannerButtons(false, true, true, harbourDetails(ALL_ON));
    expect([on.hideAdventure, on.hideColony, on.colonyTitle]).toEqual([false, false, "No target island available"]);
    expect(getScoutingView({ hidden: false, ready: false, reason: "featureOff" }))
      .toEqual({ disabled: true, hidden: false, title: MAP_OFF });
  });

  it("hides the fleet's settlement shore controls while off and disables founding on a narrowing map", () => {
    const options = { onExpeditionTargets: () => [], onQueueExpedition: () => 1, onQueuePassengers: () => true } as
      never;
    const sections = (state: FeatureStates["settlementExpeditions"]) => getFleetSections(selectFleet({
      buildings: harbours, features: { ...ALL_ON, settlementExpeditions: state } } as SettlementUiSnapshot), options);
    expect(sections("on")).toMatchObject({ shoreBlocked: undefined, shores: true });
    expect(sections("gameOff")).toMatchObject({ shores: false });
    expect(sections("mapOff")).toMatchObject({ shoreBlocked: MAP_OFF, shores: true });
  });
});

describe("fog-off harbour spot markers", () => {
  it("lists only the stored spots on landmasses without a player building", () => {
    const size = 30, blocking = new Uint8Array(size * size).fill(BLOCKING.water);
    for (let z = 2; z < 12; z++) for (let x = 2; x < 28; x++) if (x < 12 || x > 18) blocking[z * size + x] = 0;
    const spot = (x: number) => ({ rotation: 0, water: { x, z: 14 }, x, z: 6 });
    const world = { blocking, cellsX: size, cellsZ: size,
      playableIslands: { sites: [{ harbourSpots: [spot(6)] }, { harbourSpots: [spot(23)] }] } } as unknown as WorldData;
    const enemy = { militaryFaction: 1, x: 24, z: 4 }, own = { militaryFaction: 0, x: 4, z: 4 };
    expect(unsettledHarbourSpots(world, [own, enemy] as never).map(entry => entry.x)).toEqual([23]);
    expect(unsettledHarbourSpots(world, [] as never).map(entry => entry.x)).toEqual([6, 23]);
  });
});

describe("fog of war display option", () => {
  it("is locked off with its reason while the game's rules switch fog of war off", () => {
    const render = (fogLocked?: () => boolean) => renderWithI18n(createElement(WorldSection, {
      critters: true, fog: true, fogLocked, setCritters: () => {}, setFog: () => {} }));
    const fogInput = (markup: string) => {
      const [, title = "", input = ""] = markup.match(/<label[^>]*title="([^"]*)"[^>]*><input([^>]*)>/) ?? [];
      return [title, input] as const;
    };
    const [freeTitle, free] = fogInput(render(() => false));
    expect([free.includes("checked"), free.includes("disabled"), freeTitle]).toEqual([true, false,
      "Show or hide fog without changing exploration or saved island progress."]);
    const [lockedTitle, locked] = fogInput(render(() => true));
    expect([locked.includes("checked"), locked.includes("disabled"), lockedTitle])
      .toEqual([false, true, "Fog of war is off in this game"]);
  });
});
