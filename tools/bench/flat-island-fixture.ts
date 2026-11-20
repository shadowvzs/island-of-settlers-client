import type { Page } from "playwright-core";

/** One finished building of the fixture; `x`/`z` are integer cells, the footprint parity is added. */
export interface FlatIslandBuilding {
  level?: number;
  rotation: number;
  typeId: number;
  x: number;
  z: number;
}

/** A computer faction's finished depot (`aiPlace` start kit) and the AI mode the map gives the faction. */
export interface FlatIslandAiDepot {
  /** Only the ground this many cells round the depot carries a foundation (a faction without a plot). */
  buildableRadius?: number;
  faction: number;
  kit: { settlers: number; stock: Record<string, number> };
  mode: "develop" | "maintain";
  x: number;
  z: number;
}

/** One world prop (tree, bush) of the fixture, standing on the flat ground; its growth form defaults to 0. */
export interface FlatIslandProp {
  form?: number;
  scale?: number;
  type: number;
  x: number;
  z: number;
}

/** Cells round a depot whose ground `buildableRadius` closes (beyond any territory of a lone depot). */
const CLOSED_GROUND_REACH = 20;

export interface FlatIslandOptions {
  /** Computer factions with a depot; the island becomes an authored campaign map, as for `economyFactions`. */
  aiDepots?: readonly FlatIslandAiDepot[];
  buildings: readonly FlatIslandBuilding[];
  /** Square island size in cells (default 96); the HQ stands at its centre. */
  cells?: number;
  /**
   * Computer factions that run an economy (`maintain`): the island becomes an empty authored campaign map carrying
   * them in `factionAi` (a colony map would refuse base producers). Absent: a generated island without a map.
   */
  economyFactions?: readonly number[];
  /** Paints the whole island plain grass, so subjects at different plots share one backdrop. */
  grassGround?: boolean;
  name: string;
  nation: string;
  /** World props (trees, bushes) on the otherwise cleared island; they block nothing (plots stay free). */
  props?: readonly FlatIslandProp[];
  /** An ocean strip along the east edge (harbour captures); the map stays a generated home island. */
  sea?: { depth?: number; width: number };
  settlers?: number;
  stock?: Record<string, number>;
  /** Stores this many of every settlement ware first (pays any construction; `stock` overrides). */
  stockAll?: number;
}

export interface FlatIslandPlot {
  access: { x: number; z: number };
  footprint: [number, number];
  level: number;
  rotation: number;
  typeId: number;
  uid: number;
  x: number;
  z: number;
}

const FIXTURE_PAGE = "flat-island-fixture.html";

/** Opens an empty same-origin page where the fixture modules can be imported by URL. */
export const openFixturePage = async (page: Page, baseUrl: string) => {
  await page.route(`**/${FIXTURE_PAGE}`, route => route.fulfill({ body: "<body></body>", contentType: "text/html" }));
  await page.addInitScript("window.__name = value => value;");
  await page.goto(`${baseUrl}${FIXTURE_PAGE}`);
};

/**
 * Writes a flat, dry generated island (no rivers, fog off) with finished, road-connected buildings
 * as the startup game of the page's browser context. Raises each building to `level` with the
 * development level tool, so the saved level matches a real upgrade. Call on a fixture page.
 */
export const writeFlatIslandGame = (page: Page, options: FlatIslandOptions) =>
  page.evaluate(async ({
    aiDepots, buildings, cells, closedReach, economyFactions, grassGround, name, nation, props, sea, settlers,
    stock, stockAll
  }) => {
    const imp = (path: string) => import(/* @vite-ignore */ path);
    const { DEFAULT_WORLD_OPTIONS, generateWorld } = await imp("/src/shared/world/generation/generate-world.ts");
    const { getBuildingDefinition } = await imp("/src/render-common/buildings/building-catalog.ts");
    const { bakeTerrainLight } = await imp("/src/shared/world/lighting.ts");
    const { createGameSave } = await imp("/src/shared/settlement/game-save.ts");
    const { createRoadNetwork } = await imp("/src/shared/settlement/road-network.ts");
    const { createSettlementSimulation } = await imp("/src/shared/settlement/settlement-simulation.ts");
    const { openLocalSaveStore } = await imp("/src/app/save-store/local-save-store.ts");
    const { settingsStorage } = await imp("/src/app/settings/graphics-settings.ts");
    const { SETTLEMENT_WARES } = await imp("/src/shared/settlement/settlement-building-policies.ts");
    const { MATERIAL, MATERIAL_COUNT } = await imp("/src/shared/world/world-data.ts");
    const { createMapScenario } = await imp("/src/shared/world/map-scenario.ts");
    settingsStorage.writeFog(false);
    // No rivers: a flat, dry plot area (generated river water would float over the flattened ground).
    const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: cells, cellsZ: cells, erosionDroplets: 100,
      rivers: 0, seed: 1234 });
    world.heights.fill(1); world.blocking.fill(0); world.walkCost.fill(10); world.waterDepth.fill(0);
    world.buildClass.fill(4); world.buildCap.fill(4); world.slopeClass.fill(0);
    world.start = { x: cells / 2 + .5, z: cells / 2 + .5 };
    if (sea) {
      // Sea level is 0 and the flat island stands at 1: carve the strip below sea with open water above.
      // Heights, waterDepth and waterSurface use the (cells + 1)² vertex grid; the rest are cell fields.
      const depth = sea.depth ?? 3, shoreX = cells - sea.width, vertexStride = cells + 1;
      for (let vertexZ = 0; vertexZ <= cells; vertexZ++)
        for (let vertexX = shoreX; vertexX <= cells; vertexX++) {
          const vertex = vertexZ * vertexStride + vertexX;
          world.heights[vertex] = -depth; world.waterDepth[vertex] = depth; world.waterSurface[vertex] = 0;
        }
      for (let z = 0; z < cells; z++) for (let x = shoreX; x < cells; x++) {
        const cell = z * cells + x;
        world.blocking[cell] = 1; world.walkCost[cell] = 0;
        world.buildClass[cell] = 0; world.buildCap[cell] = 0; world.slopeClass[cell] = 0;
      }
    }
    const list = (pick: (prop: FlatIslandProp, index: number) => number) => props.map(pick);
    world.props = { count: props.length, form: Uint8Array.from(list(prop => prop.form ?? 0)),
      phase: Float32Array.from(list((prop, index) => prop.x * 1.7 + index * 0.61)),
      rotation: Float32Array.from(list((prop, index) => (index * 2.39996) % (Math.PI * 2))),
      scale: Float32Array.from(list(prop => prop.scale ?? 1)), types: Uint8Array.from(list(prop => prop.type)),
      x: Float32Array.from(list(prop => prop.x)), y: Float32Array.from(list(() => 1)),
      z: Float32Array.from(list(prop => prop.z)) };
    // The saved sun shadow and occlusion were baked on the generated hills: bake them on the flat ground.
    Object.assign(world, bakeTerrainLight(world, world.heights, world.waterSurface, world.sun));
    if (grassGround) {
      world.splat.fill(0);
      for (let offset = MATERIAL.grass; offset < world.splat.length; offset += MATERIAL_COUNT)
        world.splat[offset] = 255;
    }
    const factionAi = [...economyFactions.map((faction: number) => ({ faction, mode: "maintain" })),
      ...aiDepots.map(({ faction, mode }) => ({ faction, mode }))];
    // An authored campaign map starts from its headquarters only when the map places one.
    const [homeWidth, homeDepth] = getBuildingDefinition(0).gridFootprint as [number, number];
    if (factionAi.length) world.scenario = { ...createMapScenario(), kind: "campaign", nation, factionAi,
      headquarters: { rotation: 0, x: cells / 2 + homeWidth % 2 / 2, z: cells / 2 + homeDepth % 2 / 2 } };
    for (const { buildableRadius, x: depotX, z: depotZ } of aiDepots) {
      if (buildableRadius === undefined) continue;
      for (let z = Math.max(0, depotZ - closedReach); z < Math.min(cells, depotZ + closedReach); z++)
        for (let x = Math.max(0, depotX - closedReach); x < Math.min(cells, depotX + closedReach); x++)
          if (Math.max(Math.abs(x - depotX), Math.abs(z - depotZ)) > buildableRadius) world.buildCap[z * cells + x] = 0;
    }
    let simulation: any;
    const roads = createRoadNetwork(world,
      { isBlocked: (x: number, z: number) => simulation?.isOccupied(x, z) ?? false });
    const allWares = Object.fromEntries((SETTLEMENT_WARES as string[]).map(ware => [ware, stockAll]));
    simulation = createSettlementSimulation({ initialSettlers: settlers,
      initialStock: stockAll ? { ...allWares, ...stock } : stock, playerNation: nation, roads, world });
    const plots = buildings.map(({ level = 1, rotation, typeId, x: cellX, z: cellZ }) => {
      const footprint = getBuildingDefinition(typeId).gridFootprint as [number, number];
      const x = cellX + footprint[0] % 2 / 2, z = cellZ + footprint[1] % 2 / 2;
      const result = simulation.placeBuilding(typeId, x, z, rotation);
      if (!result.ok) throw new Error(`building ${typeId} rotation ${rotation}: ${result.reason}`);
      Object.assign(result.building, { construction: 1, foundationProgress: 1, required: {} });
      for (let step = 1; step < level; step++) {
        const raised = simulation.debugRaiseBuildingLevel(result.building.uid);
        if (!raised.ok) throw new Error(`building ${typeId} level ${step + 1}: ${raised.reason}`);
      }
      return { access: result.building.access, footprint, level, rotation, typeId, uid: result.building.uid, x, z };
    });
    for (const plot of plots)
      if (!simulation.connectRoads(simulation.headquarters.access, plot.access)) throw new Error("no road");
    for (const { faction, kit, x, z } of aiDepots) {
      const depot = simulation.aiPlace(faction, { typeId: 0, x, z }, kit);
      if (!depot.ok) throw new Error(`faction ${faction} depot: ${depot.reason}`);
    }
    const saved = await createGameSave(world, simulation.saveState(),
      { animals: [], name, savedAt: Date.now(), source: "generated" });
    await (await openLocalSaveStore()).writeStartupGame(JSON.stringify(saved));
    return plots as FlatIslandPlot[];
  }, { cells: 96, grassGround: false, settlers: 30, stock: {}, stockAll: 0, ...options,
    aiDepots: [...options.aiDepots ?? []], buildings: [...options.buildings], closedReach: CLOSED_GROUND_REACH,
    economyFactions: [...options.economyFactions ?? []], props: [...options.props ?? []] });
