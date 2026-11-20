import { describe, expect, it } from "vitest";

import { BRIDGE_SCENE_RIVERS, bridgeRiverScene } from "./helpers/bridge-river-scene";

describe("a soldier group order across a river bridge", () => {
  for (const kind of ["stone", "wood"] as const)
    for (const [label, river] of BRIDGE_SCENE_RIVERS)
      it(`marches eight soldiers over the ${label} ${kind} deck, never into the water or the masonry`, () => {
        const { east, onDeck, placeProblem, simulation, west } = bridgeRiverScene(river, kind);
        const types = ["shield", "heavy", "archer"] as const;
        const ids = Array.from({ length: 8 }, (_, index) => simulation.spawnDebugSoldier(
          { x: west.x - 6 - (index % 2), z: west.z - 2 + Math.floor(index / 2) },
          { rank: 0, type: types[index % types.length]! })!.id);
        const goal = { x: east.x + 7, z: east.z };
        expect(simulation.commandMilitary(ids, goal, "move")).toBe(true);
        const crossed = new Set<number>();
        for (let tick = 0; tick < 20 * 120; tick++) {
          simulation.update(.05);
          for (const frame of simulation.frames()) {
            if (!ids.includes(frame.uid) || !frame.visible) continue;
            expect(placeProblem(frame), `${frame.uid} at ${frame.x}/${frame.z}`).toBeNull();
            if (onDeck(frame)) crossed.add(frame.uid);
          }
        }
        const arrived = simulation.frames().filter(frame => ids.includes(frame.uid) &&
          Math.hypot(frame.x - goal.x, frame.z - goal.z) < 4);
        expect(new Set(arrived.map(frame => frame.uid))).toEqual(new Set(ids));
        expect(crossed).toEqual(new Set(ids));
      });
});
