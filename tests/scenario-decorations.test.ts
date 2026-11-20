import { describe, expect, it } from "vitest";

import type { RoadDecorationItemId } from "../../island-of-settlers-shared/src/road-decoration-items";
import { createScenarioDecorationLayout } from "../src/shared/settlement/scenario-decoration-layout";
import { createMapScenario, isMapScenario } from "../src/shared/world/map-scenario";
import { placeProp } from "../src/shared/world/editing/prop-placement";
import { MAX_SCENARIO_DECORATIONS } from "../src/shared/world/scenario-decorations";
import { PROP } from "../src/shared/world/world-data";
import { huntingWorld } from "./helpers/hunting-world";

const POT: RoadDecorationItemId = "roadDecoration:indigenous-flower-pot:native";
const ARCH: RoadDecorationItemId = "roadDecoration:roman-rusticated-arch:limestone";

describe("authored scenario decorations", () => {
  it("validates item identity, map bounds, yaw and the row count", () => {
    const scenario = createMapScenario();
    expect(isMapScenario({ ...scenario, decorations: [{ item: POT, x: 3, yaw: 1, z: 4 }] }, 64, 64)).toBe(true);
    const invalid = [
      { item: "roadDecoration:missing:native", x: 3, yaw: 0, z: 4 },
      { item: POT, x: 64, yaw: 0, z: 4 },
      { item: POT, x: 3, yaw: 7, z: 4 },
      { item: POT, x: 3, yaw: 0, z: 4, uid: 2 }
    ];
    for (const row of invalid) expect(isMapScenario({ ...scenario, decorations: [row] }, 64, 64)).toBe(false);
    const many = Array.from({ length: MAX_SCENARIO_DECORATIONS + 1 }, () => ({ item: POT, x: 3, yaw: 0, z: 4 }));
    expect(isMapScenario({ ...scenario, decorations: many }, 64, 64)).toBe(false);
  });

  it("measures placements with the game's decoration rules and reports refused rows", () => {
    const world = huntingWorld();
    world.scenario = { ...createMapScenario(), decorations: [{ item: ARCH, x: 20, yaw: 0, z: 20 },
      { item: POT, x: 30, yaw: 0, z: 30 }] };
    const layout = createScenarioDecorationLayout(world);
    expect(layout.frames()).toHaveLength(2);
    expect(layout.blocked()).toEqual([]);
    expect(layout.plan(POT, { x: 30, z: 30 }, 0)).toMatchObject({ ok: false, reason: "decoration-spacing" });
    expect(layout.plan(POT, { x: 40, z: 40 }, 0).ok).toBe(true);
    expect(layout.plan(POT, { x: 70, z: 40 }, 0).ok).toBe(false);
    world.scenario = { ...world.scenario, decorations: [...world.scenario.decorations!,
      { item: POT, x: 30.05, yaw: 0, z: 30 }] };
    expect(createScenarioDecorationLayout(world).blocked()).toEqual([2]);
  });

  it("lets editor decorations stand down to half a tile apart; trees still block", () => {
    const world = huntingWorld();
    world.scenario = { ...createMapScenario(), decorations: [{ item: ARCH, x: 20, yaw: 0, z: 20 },
      { item: ARCH, x: 20.6, yaw: 0, z: 20 }, { item: ARCH, x: 20.6, yaw: 0, z: 20.3 }] };
    const layout = createScenarioDecorationLayout(world);
    expect(layout.blocked()).toEqual([2]);
    expect(layout.plan(POT, { x: 20, z: 20.55 }, 0).ok).toBe(true);
    expect(layout.plan(POT, { x: 20, z: 20.45 }, 0)).toMatchObject({ ok: false, reason: "decoration-spacing" });
    expect(typeof placeProp(world, { kind: PROP.bush, seed: 1, x: 30.5, z: 30.5 })).toBe("number");
    expect(typeof placeProp(world, { kind: PROP.hardwoodTree, seed: 2, x: 40.5, z: 40.5 })).toBe("number");
    const next = createScenarioDecorationLayout(world);
    expect(next.plan(POT, { x: 31.1, z: 30.5 }, 0).ok).toBe(true);
    expect(next.plan(POT, { x: 30.8, z: 30.5 }, 0)).toMatchObject({ ok: false, reason: "decoration-spacing" });
    const besideTree = next.plan(POT, { x: 41.1, z: 40.5 }, 0);
    expect(besideTree.ok).toBe(false);
    expect(besideTree).not.toMatchObject({ reason: "decoration-spacing" });
  });
});
