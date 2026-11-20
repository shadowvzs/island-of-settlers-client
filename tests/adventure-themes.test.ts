import { describe, expect, it, vi } from "vitest";

import { expeditionMapKey } from "../src/app/settlement/colony-boot";
import { adventureIslandError, adventureOffers } from "../src/shared/settlement/adventure-rules";
import { ADVENTURE_THEMES, adventureThemeFor } from "../src/shared/settlement/adventure-themes";
import { chooseAdventureWorld } from "../src/shared/settlement/colony-world-choice";
import { createGameSave, readGameSave } from "../src/shared/settlement/game-save";
import { militaryGroundPath } from "../src/shared/settlement/military-routing";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { gatherSlot } from "../src/shared/settlement/settlement-adventure-landing";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { clearAdventureDeposits } from "../src/shared/world/generation/adventure-deposits";
import { adventureMountainAmount, generateAdventureWorld } from "../src/shared/world/generation/colony-world";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { MATERIAL, MATERIAL_COUNT, PROP, PROP_REMOVED } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

// Production code generates these islands itself: serve them from the shared world cache.
vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

describe("persisted adventure themes", () => {
  it("assigns deterministic themes to new offers and keeps all five available", () => {
    const offers = Array.from({ length: 20 }, (_, seed) => adventureOffers(seed)).flat();
    expect(new Set(offers.map(island => island.theme))).toEqual(new Set(ADVENTURE_THEMES));
    for (const island of offers) {
      expect(island.theme).toBe(adventureThemeFor(island.seed));
      expect(adventureIslandError(JSON.parse(JSON.stringify(island)))).toBeNull();
    }
    expect(adventureOffers(44)).toEqual(adventureOffers(44));
  });

  it("retains legacy terrain, with only the requested flower omission on newly charted maps", () => {
    const { theme: _theme, ...legacy } = adventureOffers(1234)[0]!;
    expect(adventureIslandError(legacy)).toBeNull();
    expect(adventureIslandError({ ...legacy, theme: "volcano" })).toMatch(/Invalid/);
    const world = generateAdventureWorld(legacy);
    const baseline = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: legacy.size, cellsZ: legacy.size,
      homeResources: false, mountains: adventureMountainAmount(legacy.seed), rivers: 0, seed: legacy.seed });
    for (let index = 0; index < baseline.props.count; index++) {
      if (baseline.props.types[index] === PROP.flowers) baseline.props.types[index] = PROP_REMOVED;
    }
    clearAdventureDeposits(baseline);
    // Expedition post-processing is not a replayable terrain recipe: markExpeditionWorld drops it.
    expect(world).toEqual({ ...baseline, expeditionKind: "adventure", generationProvenance: undefined });
    expect(expeditionMapKey(legacy, 5)).toBe(`adventure:${legacy.seed}:5`);
    expect(expeditionMapKey({ ...legacy, theme: "swamp" }, 5))
      .toBe(`adventure:${legacy.seed}:5:ecology-v4:swamp:${legacy.size}:${legacy.difficulty}`);
  });

  it.each(ADVENTURE_THEMES)("%s keeps complete hard camps reachable after ecological changes", async theme => {
    const island = { ...adventureOffers(1234)[0]!, theme, difficulty: "hard" as const };
    const world = chooseAdventureWorld(island);
    const simulation = createSettlementSimulation({ homeBuilding: null, initialSettlers: 0,
      initialStock: {}, roads: createRoadNetwork(world), world });
    expect(simulation.startAdventure({ island, troops: [] })).toEqual({ ok: true });
    const enemies = simulation.militarySoldiers().filter(soldier => (soldier.combat?.faction ?? 0) > 0);
    expect(enemies).toHaveLength(51);
    expect(simulation.adventureCampSites()).toHaveLength(6);
    const context = { buildings: [], occupied: new Uint8Array(world.cellsX * world.cellsZ), options: { world } };
    const shore = simulation.adventure()!.landing!.shore;
    const mountedStart = gatherSlot(context as never, shore, 0);
    for (const enemy of enemies) {
      const actor = simulation.frames().find(frame => frame.uid === enemy.actor)!;
      expect(militaryGroundPath(context as never, shore, actor)).not.toBeNull();
      expect(militaryGroundPath(context as never, mountedStart, actor, true)).not.toBeNull();
    }
    expect(world.adventureTheme).toBe(theme);
    const types = Array.from(world.props.types.slice(0, world.props.count)).filter(type => type !== PROP_REMOVED);
    if (theme === "tropical") {
      expect(types).toContain(PROP.palmTree);
      expect(types).not.toContain(PROP.broadleafTree);
      expect(types).not.toContain(PROP.coniferTree);
    }
    if (theme === "forest" || theme === "swamp") {
      expect(types).not.toContain(PROP.palmTree);
      expect(types).not.toContain(PROP.coniferTree);
      expect(types).toContain(PROP.birchTree);
    }
    const materialWeight = (material: number) => world.splat.reduce((sum, weight, index) =>
      sum + (index % MATERIAL_COUNT === material ? weight : 0), 0);
    if (theme === "winter") expect(materialWeight(MATERIAL.snow)).toBeGreaterThan(100_000);
    if (theme === "desert") {
      expect(materialWeight(MATERIAL.sand)).toBeGreaterThan(100_000);
      expect(types).toContain(PROP.fieldShrub); // Renderer-only cactus markers preserve the prop format.
    }
    if (theme === "swamp") expect(materialWeight(MATERIAL.lushGrass)).toBeGreaterThan(10_000);
    for (let vertex = 0; vertex < world.heights.length; vertex++) {
      const weights = world.splat.subarray(vertex * MATERIAL_COUNT, (vertex + 1) * MATERIAL_COUNT);
      // The shared generator independently rounds splat channels; preserve that tolerance.
      const total = weights.reduce((sum, value) => sum + value, 0);
      expect(total).toBeGreaterThanOrEqual(252);
      expect(total).toBeLessThanOrEqual(258);
    }
    if (theme === "forest") {
      const saved = await createGameSave(world, simulation.saveState(),
        { name: "Themed adventure", savedAt: 123, source: "generated", animals: [] });
      const restored = await readGameSave(saved);
      expect(restored.settlement.adventure!.island.theme).toBe("forest");
      // Loading uses the actual saved terrain and vegetation, not a fresh themed generation.
      expect(restored.map.world.heights).toEqual(world.heights);
      expect(restored.map.world.props.types).toEqual(world.props.types);
      expect(restored.map.world.splat).toEqual(world.splat);
    }
  }, 60000);
});
