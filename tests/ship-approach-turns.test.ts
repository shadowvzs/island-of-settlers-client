import { describe, expect, it } from "vitest";

import { manoeuvreShip } from "../src/shared/settlement/settlement-ship-steering";
import { createApproachTurns } from "./helpers/approach-turns";
import { createLighterScenario } from "./helpers/harbour-lighter-scenario";
import { SHIP_TICK } from "./helpers/ship-motion-scenarios";

const degrees = (radians: number) => radians * 180 / Math.PI;
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Owner bug 2026-10-22: a ship spun round on its way to the pier. */
describe("no spinning on the way to the pier", () => {
  it("faces a manoeuvre start it ran half a tile past and comes straight onto it, no swing past and back", () => {
    // The 8-ship queue scenario's case: heading 11°, half a tile past a settle point; a pivot to -19° follows.
    const yaw = -19 * Math.PI / 180;
    const route = [{ settle: true, x: 26.1, yaw, z: 47.4 }, { pivot: 0, x: 26.1, yaw, z: 47.4 }];
    let ship = { speed: 0, x: 25.6, yaw: 11 * Math.PI / 180, z: 47.6 }, turned = 0, cursor = 0;
    for (let tick = 0; tick < 2000 && cursor < route.length; tick++) {
      const move = manoeuvreShip(ship, route, cursor, SHIP_TICK);
      turned += Math.abs(degrees(wrap(move.yaw - ship.yaw)));
      ship = { speed: move.speed, x: move.x, yaw: move.yaw, z: move.z };
      cursor += move.advance;
    }
    expect(Math.hypot(ship.x - 26.1, ship.z - 47.4)).toBeLessThan(.05);
    expect(Math.abs(degrees(wrap(ship.yaw - yaw)))).toBeLessThan(1);
    // Before the fix: an arc swung it to -104° and the pivot back to -19°, ~200° in all; now ~130°.
    expect(turned).toBeLessThan(150);
  });
  it("turns no more than about half a circle one way round on any berth approach (8 own ships)", () => {
    const turns = createApproachTurns(), { fleet } = createLighterScenario({ boats: 0, ships: 8 });
    for (let tick = 0; tick < 900 / SHIP_TICK; tick++) {
      fleet.update(SHIP_TICK);
      turns.update(fleet.saveState().ships);
    }
    expect(turns.spin()).toBeLessThan(200);
    // Before the fix 537° in all (the settle swing past and back); now 453°, the planned turns.
    expect(turns.most()).toBeLessThan(500);
  }, 60000);
});
