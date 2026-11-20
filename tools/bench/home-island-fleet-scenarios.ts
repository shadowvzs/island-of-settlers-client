import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { DEFAULT_WORLD_OPTIONS } from "../../src/shared/world/generation/generate-world";
import { startHomeIslandProfile } from "./home-island-cpu-profile";
import { HOME_FLEET_FIXTURES, placeHomeFleetHarbour, readHomeFleetFixture } from "./home-island-fleet-fixture";

export const FIXTURE_COUNTS = [2, 5, 9] as const;
export const LOADS = [
  { name: "light", ships: 4 },
  { name: "heavy", ships: 8 }
] as const;
const TICK = 0.05;
const DEFAULT_HORIZON_TICKS = 60_000;
const FIXTURE_DIRECTORY = HOME_FLEET_FIXTURES;

interface ScenarioResult {
  activeWaitSeconds: number;
  counts: { actors: number; buildings: number; ships: number };
  delivered: number;
  founderFinished: boolean | null;
  founderTicks: number | null;
  founderOrder: number | null;
  founderTargets: number;
  founderLost: boolean;
  landmasses: number;
  load: string;
  longestWaitSeconds: number;
  maxQueue: number;
  outstanding: number;
  scoutTicks: number | null;
  scoutFinished: boolean | null;
  strandedEntries: number;
  strandedTicks: number;
  ticks: number;
  update: { meanMs: number; p95Ms: number; p99Ms: number; maxMs: number };
  wallMs: number;
  heapNetPerTickBytes: number | null;
  loadingPrewarm: { milliseconds: number; probes: number };
}
const percentile = (sorted: readonly number[], fraction: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
const heapUsed = () => {
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  return process.memoryUsage().heapUsed;
};
const runScenario = async (landmasses: number, load: string, targetShips: number,
  horizonTicks: number): Promise<ScenarioResult> => {
  const { save, sites, world } = await readHomeFleetFixture(landmasses);
  const roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ world, roads });
  const loaded = simulation.loadState(save);
  if (!loaded.ok) throw new Error(`Fixture ${landmasses} did not load: ${loaded.reason}`);
  simulation.headquarters.inventory = {
    bow: 3, hammer: 20, planks: 400, shovel: 20, spyglass: 2, stone: 400
  };
  const sourceUid = placeHomeFleetHarbour(simulation, world, sites[0]!);
  const destinationUid = placeHomeFleetHarbour(simulation, world, sites[1]!);
  const source = simulation.buildings().find(building => building.uid === sourceUid)!;
  const destination = simulation.buildings().find(building => building.uid === destinationUid)!;
  if (targetShips > 4 || process.argv.includes("--two-berths")) {
    // Heavy load: both busy harbours have the level-2 upgrade that unlocks a second berth where the shore allows.
    source.workshopUpgrade = { level: 2 };
    destination.workshopUpgrade = { level: 2 };
  }
  console.log(`  harbours ${source.uid}/${destination.uid}, berths ` +
    `${simulation.harbourBerths(source.uid).length}/${simulation.harbourBerths(destination.uid).length}`);
  source.inventory = { hammer: 20, planks: 200, shovel: 20, spyglass: 1, stone: 200 };
  destination.inventory = { hammer: 2, shovel: 2 };
  // Create the finite fleet before reserving mission ships; a later "free ships" top-up would
  // silently add a thirteenth/twenty-fifth ship on top of the reserved founder/scout.
  simulation.debugEnsureFreeShips(source.uid, targetShips);
  const scoutOrder = process.argv.includes("--no-scout") ? null : simulation.queueSeaExploration(source.uid);
  const founderTargets = process.argv.includes("--founder") && landmasses >= 5 ?
    simulation.seaExpeditionDestinations(source.uid) : [];
  const founderOrder = founderTargets.length ? simulation.queueSeaExpedition(source.uid, founderTargets[0]!) : null;
  console.log(`  scouting ${scoutOrder ?? "not queued"}; founding targets ${founderTargets.length}, ` +
    `order ${founderOrder ?? "not queued"}`);
  let founderTicks: number | null = founderOrder === null ? null : 0;
  const outbound = Math.ceil(targetShips / 2), returning = Math.floor(targetShips / 2);
  source.inventory.planks = (source.inventory.planks ?? 0) + outbound;
  // Return a ware the asynchronously prepared founder/scout never consumes. Measuring stone
  // against its pre-preparation stock falsely reports six delivered stones as missing.
  destination.inventory.logs = (destination.inventory.logs ?? 0) + returning;
  const sourceLogs = source.inventory.logs ?? 0;
  const delivered = () => (destination.inventory.planks ?? 0) >= outbound &&
    (source.inventory.logs ?? 0) - sourceLogs >= returning;
  if (!process.argv.includes("--no-visitors")) {
    simulation.sendVisitorShip({ fish: 10 }, [], "supply", [], 0);
    simulation.sendVisitorShip({ logs: 8 }, [], "supply", [], 0);
  }
  for (let index = 0; index < outbound; index++)
    if (simulation.queueSeaTransport(source.uid, destination.uid, { planks: 1 }) === null)
      throw new Error("Outbound supply order refused");
  for (let index = 0; index < returning; index++)
    if (simulation.queueSeaTransport(destination.uid, source.uid, { logs: 1 }) === null)
      throw new Error("Return supply order refused");
  const durations: number[] = [], waitStart = new Map<number, number>();
  let longestWait = 0, maxQueue = 0, strandedTicks = 0, strandedEntries = 0, ticks = 0, activeWait = 0;
  let scoutTicks: number | null = null;
  let founderLost = false;
  const previousPhase = new Map<number, string>();
  const heapBefore = heapUsed();
  const prewarmStarted = performance.now();
  let prewarmProbes = 0;
  for (const _ of simulation.prewarmCoastalGeometry()) prewarmProbes++;
  const loadingPrewarm = { milliseconds: performance.now() - prewarmStarted, probes: prewarmProbes };
  const profile = await startHomeIslandProfile(option("--cpu-profile"), landmasses);
  const started = performance.now();
  const founderComplete = () => founderOrder === null || simulation.buildings().some(building =>
    building.foundedByExpedition && building.construction === 1) &&
    !simulation.ships().some(ship => ship.phase === "founding");
  const scoutComplete = () => scoutOrder === null || !simulation.ships().some(ship => ship.exploration) &&
    !simulation.seaOrders().some(order => order.id === scoutOrder);
  while (ticks < horizonTicks && (!delivered() || !founderComplete() || !scoutComplete())) {
    maxQueue = Math.max(maxQueue, simulation.seaOrders().length);
    const ships = simulation.ships();
    if (scoutOrder !== null && scoutTicks === null && !ships.some(ship => ship.exploration) &&
      !simulation.seaOrders().some(order => order.id === scoutOrder))
      scoutTicks = ticks;
    if (founderOrder !== null && founderTicks !== null &&
      simulation.buildings().some(building => building.foundedByExpedition && building.construction === 1))
      if (!founderTicks) founderTicks = ticks;
    for (const ship of ships) {
      if (ship.visitor) continue;
      const busy = ship.phase !== "idle" || ship.passengers > 0 ||
        Object.values(ship.cargo).some(count => count > 0);
      if (!busy) {
        const since = waitStart.get(ship.id);
        if (since !== undefined) longestWait = Math.max(longestWait, (ticks - since) * TICK);
        waitStart.delete(ship.id);
      } else if (!waitStart.has(ship.id)) waitStart.set(ship.id, ticks);
      if (ship.phase === "stranded" && previousPhase.get(ship.id) !== "stranded") strandedEntries++;
      if (ship.phase === "stranded") strandedTicks++;
      previousPhase.set(ship.id, ship.phase);
    }
    const start = performance.now();
    simulation.update(TICK);
    const duration = performance.now() - start;
    durations.push(duration);
    profile?.tick(ticks + 1, start, duration, world.buildRevision ?? 0, world.terrainRevision ?? 0);
    ticks++;
    if (founderOrder !== null && !simulation.buildings().some(building => building.foundedByExpedition) &&
      !simulation.ships().some(ship => ship.expedition || ship.phase === "founding") &&
      !simulation.seaOrders().some(order => order.id === founderOrder) &&
      !simulation.seaExpeditionPreparations().some(preparation => preparation.sourceUid === source.uid)) {
      founderLost = true;
      break;
    }
    if (ticks % 5000 === 0) {
      console.log(`  ${ticks} ticks, ${destination.inventory.planks ?? 0}/${outbound} out, ` +
        `${(source.inventory.logs ?? 0) - sourceLogs}/${returning} back, ` +
        `queue ${simulation.seaOrders().length}`);
      const diagnostic = option("--diagnostic");
      if (diagnostic) await writeFile(resolve(diagnostic), JSON.stringify({ destinationUid: destination.uid,
        sourceUid: source.uid, state: simulation.saveState(), ticks }, null, 2));
    }
  }
  const wallMs = performance.now() - started;
  await profile?.stop();
  const fixtureOutput = option("--fixture-output");
  if (fixtureOutput) {
    await mkdir(resolve(fixtureOutput), { recursive: true });
    await writeFile(resolve(fixtureOutput, `fleet-${targetShips}-${landmasses}.save.json`), JSON.stringify(
      await createGameSave(world, simulation.saveState(), { animals: [],
        name: `Active ${targetShips}-ship / ${landmasses}-landmass review`, savedAt: 1_000_000,
        source: "generated" })));
  }
  const heapAfter = heapUsed();
  for (const [, since] of waitStart)
    activeWait = Math.max(activeWait, (ticks - since) * TICK);
  const sorted = [...durations].sort((first, second) => first - second);
  const phases: Record<string, number> = {};
  for (const ship of simulation.ships()) phases[ship.phase] = (phases[ship.phase] ?? 0) + 1;
  console.log(`  final ships ${JSON.stringify(phases)} queue ${simulation.seaOrders().length}`);
  if (!delivered() && !process.argv.includes("--prepare-only")) console.log(JSON.stringify({ source: source.uid, destination: destination.uid,
    sourceBerths: simulation.harbourBerths(source.uid), destinationBerths: simulation.harbourBerths(destination.uid),
    ships: simulation.saveState().naval.fleet.ships.filter(ship => !ship.visitor).map(ship => ({
      anchorage: ship.anchorage, cargo: ship.cargo, destinationUid: ship.destinationUid, id: ship.id,
      orderId: ship.orderId, passengers: ship.passengers, phase: ship.phase, queuedAt: ship.queuedAt,
      retryPhase: ship.retryPhase, route: ship.route.length, routeEnd: ship.route.at(-1), sourceUid: ship.sourceUid,
      terrainBlocked: ship.terrainBlocked, timer: ship.timer, waitsAtEdge: ship.waitsAtEdge,
      x: ship.x, z: ship.z })) }, null, 2));
  const result: ScenarioResult = {
    loadingPrewarm,
    activeWaitSeconds: activeWait,
    counts: { actors: simulation.frames().length, buildings: simulation.buildings().length,
      ships: simulation.ships().length },
    delivered: Number(delivered()),
    founderFinished: founderOrder === null ? null : founderComplete(),
    founderTicks: founderTicks !== null &&
      simulation.buildings().some(building => building.foundedByExpedition && building.construction === 1) ?
      founderTicks || ticks : null,
    founderOrder,
    founderTargets: founderTargets.length,
    founderLost,
    landmasses, load,
    longestWaitSeconds: longestWait, maxQueue,
    outstanding: Math.max(0, outbound - (destination.inventory.planks ?? 0)) +
      Math.max(0, returning - ((source.inventory.logs ?? 0) - sourceLogs)),
    scoutTicks: scoutOrder !== null && scoutComplete() ? scoutTicks ?? ticks : null,
    scoutFinished: scoutOrder === null ? null : scoutComplete(), strandedEntries, strandedTicks, ticks,
    update: { meanMs: durations.reduce((sum, value) => sum + value, 0) / Math.max(1, durations.length),
      p95Ms: percentile(sorted, .95), p99Ms: percentile(sorted, .99),
      maxMs: sorted.at(-1) ?? 0 },
    wallMs,
    heapNetPerTickBytes: (globalThis as { gc?: () => void }).gc ?
      (heapAfter - heapBefore) / Math.max(1, ticks) : null
  };
  const diagnostic = option("--diagnostic");
  if (diagnostic) await writeFile(resolve(diagnostic), JSON.stringify({ destinationUid: destination.uid,
    sourceUid: source.uid, state: simulation.saveState(), result }, null, 2));
  return result;
};

const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const main = async () => {
  const output = resolve(option("--output") ??
    "../resources/project-reviews/home-island-acceptance-2026-10-27/fleet-scenarios.json");
  await mkdir(resolve(output, ".."), { recursive: true });
  const results: ScenarioResult[] = [];
  const wantedCount = Number(option("--count") ?? 0), wantedLoad = option("--load");
  const horizon = Number(option("--horizon") ?? (process.argv.includes("--prepare-only") ? 300 : DEFAULT_HORIZON_TICKS));
  for (const landmasses of FIXTURE_COUNTS.filter(count => !wantedCount || count === wantedCount))
    for (const load of LOADS.filter(entry => !wantedLoad || entry.name === wantedLoad)) {
      const ships = Number(option("--ships") ?? load.ships);
      console.log(`running ${landmasses} landmasses ${load.name} (${ships} ships)...`);
      const result = await runScenario(landmasses, load.name, ships, horizon);
      results.push(result);
      await writeFile(output, `${JSON.stringify({ fixture: FIXTURE_DIRECTORY, tick: TICK,
        worldDefaults: DEFAULT_WORLD_OPTIONS, results }, null, 2)}\n`);
      console.log(`${landmasses} landmasses ${load.name.padEnd(5)} ships ${String(ships).padStart(2)}: ` +
        `${result.delivered ? "done" : `outstanding ${result.outstanding}`} ` +
        `${result.ticks} ticks (${(result.ticks * TICK).toFixed(0)} s sim) ` +
        `founder ${result.founderTicks ?? "n/a"} ticks, wait ${result.longestWaitSeconds.toFixed(0)} s, ` +
        `mean ${result.update.meanMs.toFixed(3)} ms p99 ${result.update.p99Ms.toFixed(2)} ms`);
    }
  await writeFile(output, `${JSON.stringify({ fixture: FIXTURE_DIRECTORY, tick: TICK,
    worldDefaults: DEFAULT_WORLD_OPTIONS, results }, null, 2)}\n`);
  console.log(`Wrote ${output}`);
  if (!process.argv.includes("--prepare-only") &&
    results.some(result => result.delivered !== 1 || result.founderFinished === false || result.scoutFinished === false))
    process.exitCode = 1;
};
await main();
