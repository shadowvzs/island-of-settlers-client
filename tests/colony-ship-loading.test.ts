import { describe, expect, it } from "vitest";

import { colonyTroopCount } from "../src/shared/settlement/colony-expedition-rules";
import { DEBUG_EXPEDITION_TROOPS } from "../src/shared/settlement/settlement-debug-expeditions";
import { edgeBaySettlement } from "./helpers/edge-bay-settlement";

const settlement = edgeBaySettlement;
const ownShips = (simulation: ReturnType<typeof settlement>) => simulation.ships().filter(ship => !ship.visitor);

describe("colony ship loading", () => {
  // Regression (owner, 2026-10-12): after "Test adventure" the last load never sailed. Granted ships
  // were dropped where they could not reach the berth, and an empty ship back from the voyage
  // re-entered on the way in and docked while the next ship headed for the berth: both waited forever.
  it("sails every load of a test adventure in real-time steps when the harbour lies at the map edge", () => {
    const simulation = settlement();
    const started = simulation.startDebugExpedition("adventure");
    expect(started, JSON.stringify(started)).toMatchObject({ ok: true });
    const expedition = () => simulation.colonyExpeditions()[0]!;
    const ships = ownShips(simulation);
    expect(ships.length).toBeGreaterThanOrEqual(expedition().loads);
    expect(ships.every(ship => ship.phase === "idle" || ship.phase === "positioning")).toBe(true);
    // Real boarding serializes the harbour/pier lane; this case completes in about 458 game seconds.
    for (let step = 0; step < 12000 && expedition().status !== "arrived"; step++) simulation.update(0.05);
    expect(expedition()).toMatchObject({ arrived: expedition().loads, status: "arrived" });
    const landed = simulation.colonyLanding(expedition().id)!;
    expect(landed.troops).toHaveLength(colonyTroopCount(DEBUG_EXPEDITION_TROOPS));
  }, 120000);
});
