/** Controlled flat map, but real received troops, roads, assignment and walking simulation. */
export const createVerificationGarrisonSave = async (nation: string, types: number[] = [1, 2, 4, 9]) => {
  const imp = (path: string) => import(/* @vite-ignore */ path);
  const { DEFAULT_WORLD_OPTIONS, generateWorld } = await imp("/src/shared/world/generation/generate-world.ts");
  const { getBuildingDefinition } = await imp("/src/render-common/buildings/building-catalog.ts");
  const { createGameSave } = await imp("/src/shared/settlement/game-save.ts");
  const { createRoadNetwork } = await imp("/src/shared/settlement/road-network.ts");
  const { createSettlementSimulation } = await imp("/src/shared/settlement/settlement-simulation.ts");
  const { openLocalSaveStore } = await imp("/src/app/save-store/local-save-store.ts");
  const { settingsStorage } = await imp("/src/app/settings/graphics-settings.ts");
  settingsStorage.writeFog(false);
  const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96,
    erosionDroplets: 100, seed: 1234 });
  world.heights.fill(1); world.blocking.fill(0); world.walkCost.fill(10);
  world.buildClass.fill(4); world.buildCap.fill(4); world.slopeClass.fill(0);
  world.start = { x: 48.5, z: 48.5 }; world.props.count = 0;
  let simulation: any;
  const roads = createRoadNetwork(world, {
    isBlocked: (x: number, z: number) => simulation?.isOccupied(x, z) ?? false
  });
  simulation = createSettlementSimulation({ initialSettlers: 30,
    initialStock: { cloth: 80, coins: 40, planks: 80, stone: 80 }, playerNation: nation, roads, world });
  const plots = types.map((type, index) => {
    const [width, depth] = getBuildingDefinition(type).gridFootprint;
    const x = 26 + index * 14 + width % 2 / 2, z = 70 + depth % 2 / 2;
    const result = simulation.placeBuilding(type, x, z, 0);
    if (!result.ok) throw new Error(`Garrison fixture ${type}: ${result.reason}`);
    Object.assign(result.building, { construction: 1, foundationProgress: 1, required: {} });
    return { access: result.building.access, type, uid: result.building.uid, x, z };
  });
  for (const plot of plots) {
    if (!simulation.connectRoads(simulation.headquarters.access, plot.access))
      throw new Error(`Garrison fixture road ${plot.type}`);
    simulation.setMilitaryCoins(plot.uid, false);
  }
  simulation.receiveTroops(Array.from({ length: 36 }, (_, index) => ({
    hp: 100, rank: index % 3, type: ["archer", "shield", "heavy"][index % 3]
  })));
  for (let tick = 0; tick < 12000; tick++) simulation.update(.05);
  const soldiers = simulation.militarySoldiers();
  const frames = simulation.frames();
  const stationed = plots.map(plot => ({ uid: plot.uid, count: soldiers.filter((soldier: any) =>
    soldier.building === plot.uid && soldier.stationed).length }));
  const saved = await createGameSave(world, simulation.saveState(),
    { animals: [], name: "Verification garrison", savedAt: 123, source: "generated" });
  await (await openLocalSaveStore()).writeStartupGame(JSON.stringify(saved));
  return { plots, stationed, soldierCount: soldiers.length, actorCount: frames.length };
};
