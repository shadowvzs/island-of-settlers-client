import { describe, expect, it } from "vitest";

import { listShoreShellSpots } from "../src/render-common/props/shore-shell-spots";
import { removePropsAt } from "../src/shared/world/editing/prop-removal";
import {
  createGeneratedPropRef, type GeneratedPropRef, resolveGeneratedProp
} from "../src/shared/world/generated-prop-ref";
import { createMapScenario } from "../src/shared/world/map-scenario";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { writeMapFile } from "../src/shared/world/save/map-writer";
import { PROP_REMOVED, type WorldData } from "../src/shared/world/world-data";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

const REGENERATED = { ...SMALL_EDITOR_WORLD, seed: SMALL_EDITOR_WORLD.seed + 17 };
preloadWorlds(SMALL_EDITOR_WORLD, REGENERATED);

const INPUT = { animals: [], name: "Props", savedAt: 1_700_000_000_000, source: "test" };
const firstProp = (world: WorldData) => {
  for (let index = 0; index < world.props.count; index++) if (world.props.types[index] !== PROP_REMOVED) return index;
  throw new Error("The fixture world has no props");
};
const roundTrip = async (world: WorldData) => (await readMapFile(await writeMapFile(world, INPUT))).world;

describe("generated prop references (ACT1)", () => {
  it("resolves after a map save/load and fails after terrain regeneration", async () => {
    const world = cachedWorld(SMALL_EDITOR_WORLD);
    const ref = createGeneratedPropRef(world, "prop", firstProp(world))!;
    expect(resolveGeneratedProp(world, ref)).toEqual({ index: ref.index, status: "ok" });
    expect(resolveGeneratedProp(await roundTrip(world), ref)).toEqual({ index: ref.index, status: "ok" });
    expect(resolveGeneratedProp(cachedWorld(REGENERATED), ref).status).not.toBe("ok");
  });

  it("finds the identical object at another index, suggests a nearby one and reports a removed one", () => {
    const world = structuredClone(cachedWorld(SMALL_EDITOR_WORLD));
    const index = firstProp(world);
    const ref = createGeneratedPropRef(world, "prop", index)!;
    const shifted: GeneratedPropRef = { ...ref, index: index + world.props.count };
    expect(resolveGeneratedProp(world, shifted)).toEqual({ index, status: "reindexed" });
    const nudged: GeneratedPropRef = { ...ref, fingerprint: { ...ref.fingerprint, x: ref.fingerprint.x + .3 } };
    expect(resolveGeneratedProp(world, nudged).status).toBe("moved");
    removePropsAt(world, [index]);
    expect(resolveGeneratedProp(world, ref).status).not.toBe("ok");
    expect(createGeneratedPropRef(world, "prop", index)).toBeNull();
  });

  it("fingerprints shore shells and stone deposits by their stable order", () => {
    const world = structuredClone(cachedWorld(SMALL_EDITOR_WORLD));
    world.scenario = { ...createMapScenario(),
      marbleDeposits: [{ id: 3, material: "granite", remaining: 10, x: 20.5, z: 30.5 }] };
    const deposit = createGeneratedPropRef(world, "deposit", 3)!;
    expect(deposit.fingerprint).toEqual({ kind: 3, x: 20.5, z: 30.5 });
    expect(resolveGeneratedProp(world, deposit)).toEqual({ index: 3, status: "ok" });
    world.scenario.marbleDeposits![0]!.material = "marble";
    expect(resolveGeneratedProp(world, deposit)).toEqual({ status: "missing" });
    if (!listShoreShellSpots(world).length) return;
    const shell = createGeneratedPropRef(world, "shell", 0)!;
    expect(resolveGeneratedProp(world, shell)).toEqual({ index: 0, status: "ok" });
  });
});
