import { afterEach, describe, expect, it, vi } from "vitest";

import { getCritterModel, loadCritterSpecies } from "../src/render-common/critters/critter-models";
import { CRITTER } from "../src/render-common/critters/critter-species";
import { loadCritterGlb } from "../src/render-common/critters/model/critter-glbs";
import { createCritterFrame } from "../src/render-common/critters/sim/critter-pool";
import { createPresentationScheduler } from "../src/render-common/presentation-scheduler";
import { createThreeCritters } from "../src/renderers/three/three-critters";

afterEach(() => vi.restoreAllMocks());

describe("critter model loading", () => {
  it("builds code-built species without any file", async () => {
    const fetchGlb = vi.fn(async () => new ArrayBuffer(0));
    expect(await loadCritterSpecies([CRITTER.frog, CRITTER.gull], fetchGlb)).toEqual([CRITTER.frog, CRITTER.gull]);
    expect(fetchGlb).not.toHaveBeenCalled();
    expect(getCritterModel(CRITTER.frog)).toBeDefined();
  });

  it("fetches a shared file once for every species built from it", async () => {
    const fetchGlb = vi.fn(async () => new ArrayBuffer(0));
    // Already loaded by the test setup: nothing is fetched again.
    const loaded = await loadCritterSpecies([CRITTER.chamois, CRITTER.chamoisKid, CRITTER.mallardHen], fetchGlb);
    expect(loaded).toEqual([CRITTER.chamois, CRITTER.chamoisKid, CRITTER.mallardHen]);
    expect(fetchGlb).not.toHaveBeenCalled();
  });

  it("skips a file that fails and warns once, without fetching it again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchGlb = vi.fn(async () => { throw new Error("offline"); });
    const url = "/assets/models/critters/missing/missing.glb";
    expect(await loadCritterGlb(url, fetchGlb)).toBe(false);
    expect(await loadCritterGlb(url, fetchGlb)).toBe(false);
    expect(fetchGlb).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("three critters", () => {
  it("builds a species first met after the first draw in leftover frame time", async () => {
    const presentation = createPresentationScheduler();
    const critters = createThreeCritters({}, false, false, presentation);
    const frame = createCritterFrame(4, 1);
    frame.species[0] = CRITTER.bear;
    frame.count = 1;
    critters.update(frame);
    expect(critters.getDrawnCounts()[CRITTER.bear]).toBe(0);
    await critters.whenReady();
    expect(presentation.size()).toBe(1);
    presentation.runBudget(100);
    critters.update(frame);
    expect(critters.getDrawnCounts()[CRITTER.bear]).toBe(1);
  });
});
