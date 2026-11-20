import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { stageGameSession } from "../../src/app/settlement/game-session";
import { createIslandStoneDeposits } from "../../src/app/settlement/island-stone-deposits";
import type { IslandStoneLedgerState } from "../../src/app/settlement/island-stone-ledger";
import { estimateOfflineEconomyRates } from "../../src/app/settlement/offline-economy-rates";
import { advanceOfflineGame } from "../../src/app/settlement/offline-progress";
import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { getKnownRocks } from "../../src/render-common/rocks/island-rock-instances";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { getBuildingProductionRule, STORAGE_IDS } from "../../src/shared/settlement/production-rules";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { overlapsSettlementGround } from "../../src/shared/settlement/settlement-ground-clearance";
import type { Goods } from "../../src/shared/settlement/settlement-types";
import { resourceWorkRadius } from "../../src/shared/settlement/settlement-work-ranges";
import {
  type BuildingProduction, groupMetalworksProduction, metalworksToolWares,
  offlineProductionIslands, offlineProductionSchema
} from "./offline-production-comparison";

/** Original, unmodified owner save; independent exact reference still runs if the candidate throws.
 * Usage from island-of-settlers-client/: npx tsx tools/analysis/offline-supplied-save-review.ts SAVE OUTPUT_DIRECTORY
 * EXACT_SECONDS defaults to 3600; the 24h candidate is a separate performance probe, never an accuracy claim.
 */
const sourcePath = resolve(process.argv[2] ?? "");
const output = resolve(process.argv[3] ?? "../resources/offline-economy/supplied-save");
const exactSeconds = Number(process.env.EXACT_SECONDS ?? 3600);
if (!process.argv[2] || !Number.isSafeInteger(exactSeconds) || exactSeconds < 300 || exactSeconds > 3600)
  throw new Error("Supply a save path; EXACT_SECONDS must be an integer from 300 to 3600");
const bytes = await readFile(sourcePath), source = JSON.parse(bytes.toString("utf8")) as GameSaveV1;
const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const inputHash = digest(bytes);
await mkdir(output, { recursive: true });
const write = async (name: string, value: unknown) => writeFile(resolve(output, name), JSON.stringify(value, null, 2) + "\n");
const add = (goods: Goods, ware: string, amount = 1) => {
  if (!ware.startsWith("~")) goods[ware] = (goods[ware] ?? 0) + amount;
};
const stock = (save: GameSaveV1) => {
  const storage: Goods = {}, input: Goods = {}, products: Goods = {}, reserves: Goods = {};
  for (const building of save.settlement.buildings) {
    if (building.militaryFaction) continue;
    for (const [ware, count] of Object.entries(building.inventory)) add(storage, ware, count);
    for (const [ware, count] of Object.entries(building.input)) add(input, ware, count);
    for (const [ware, count] of Object.entries(building.output)) add(products, ware, count);
    for (const [ware, count] of Object.entries(building.shipReserve ?? {})) add(reserves, ware, count);
  }
  return { storage, input, output: products, shipReserves: reserves,
    note: "Disjoint building stocks only; actor cargo, paid work and transit escrow are separate owners. Incoming is a reservation, not additional stock." };
};
const loaded = await stageGameSession(source), world = loaded.map.world;
const roads = createRoadNetwork(world);
if (!roads.replaceSegments(source.settlement.roads)) throw new Error("Invalid road network");
const rates = estimateOfflineEconomyRates(source, world);
const stores = source.settlement.buildings.filter(building => STORAGE_IDS.has(building.typeId));
const buildings = source.settlement.buildings.map(building => {
  const rule = getBuildingProductionRule(building, source.settlement.playerNation ?? "roman");
  const rate = rates.buildings.find(rate => rate.uid === building.uid);
  const worker = source.settlement.actors.find(actor => actor.uid === building.worker);
  return { uid: building.uid, typeId: building.typeId, name: getBuildingDefinition(building.typeId).name,
    x: building.x, z: building.z, construction: building.construction,
    owned: !building.militaryFaction, paused: !!building.productionPaused, status: building.status,
    selectedOutput: building.selectedOutput, cycle: building.cycle,
    input: building.input, output: building.output, incoming: building.incoming,
    recipe: rule, modeledRate: rate,
    unsupported: rates.unsupported.find(entry => entry.uid === building.uid)?.reason,
    worker: worker && { uid: worker.uid, phase: worker.phase, action: worker.action,
      ware: worker.ware, target: worker.target, preparedTarget: worker.preparedTarget,
      productionInputs: worker.productionInputs, productionOutput: worker.productionOutput },
    storageRoutes: stores.map(storage => { const route = roads.routeMetrics(building.access, storage.access).route;
      return { uid: storage.uid, connected: !!route, length: route?.length, cost: route?.cost }; }) };
});
// Detached source diagnostic: spend each target's advertised finite amount without removing props.
const stoneLedger = createIslandStoneDeposits(world, () => {},
  (source.runtime as { stone?: IslandStoneLedgerState } | undefined)?.stone);
const quarryProbes = source.settlement.buildings.filter(building => building.typeId === 19).map(building => {
  const targets = stoneLedger.targets(building.access, resourceWorkRadius("stone"));
  const state = stoneLedger.saveState();
  return { buildingUid: building.uid, targets: targets.map(target => {
    let advertised = state.formations.find(([id]) => id === target.id)?.[3] ?? 0;
    if (target.id >= 0) advertised = state.props.find(([id]) => id === target.id)?.[1] ?? 6;
    else if (target.id <= -1_000_000) advertised = state.seams.find(([id]) => id === target.id)?.[1] ?? 12;
    let consumable = 0;
    while (consumable < advertised && stoneLedger.consume(target)) consumable++;
    return { target, advertised, consumable, consistent: consumable === advertised,
      mountainSearchClearanceBlocked: overlapsSettlementGround(world, target.x - .4, target.z - .4,
        target.x + .4, target.z + .4),
      extractionClearanceBlocked: overlapsSettlementGround(world, target.x - .6, target.z - .6,
        target.x + .6, target.z + .6) };
  }) };
});
const sourceFiles = ["game-session.ts", "offline-progress.ts", "offline-island-replay.ts",
  "offline-economy.ts", "offline-economy-events.ts", "offline-economy-rates.ts",
  "offline-economy-sources.ts", "offline-economy-wildlife.ts", "offline-economy-logistics.ts",
  "offline-economy-deliveries.ts", "offline-economy-arrivals.ts", "offline-economy-outputs.ts",
  "island-stone-deposits.ts"].map(name => resolve(import.meta.dirname, "../../src/app/settlement", name));
const fingerprints = await Promise.all(sourceFiles.map(async path => ({ path, sha256: digest(await readFile(path)) })));
const audit = { measuredAt: new Date().toISOString(), sourcePath, inputHash, bytes: bytes.length,
  valid: true, savedAt: source.savedAt, dimensions: [world.cellsX, world.cellsZ], seed: world.seed,
  buildings: buildings.length, actors: source.settlement.actors.length, idleSettlers: source.settlement.settlers,
  jobs: Object.fromEntries([...new Set(source.settlement.actors.map(actor => actor.job))].sort()
    .map(job => [job, source.settlement.actors.filter(actor => actor.job === job).length])),
  roadSegments: source.settlement.roads.length,
  roadTiers: Object.fromEntries([...new Set(source.settlement.roads.map(road => road.tier ?? "dirt"))]
    .map(tier => [tier, source.settlement.roads.filter(road => (road.tier ?? "dirt") === tier).length])),
  archivedColonies: source.archipelago?.colonies.length ?? 0, archipelagoPresent: !!source.archipelago,
  originalStock: stock(source), buildingsDetail: buildings, rates, quarryProbes,
  knownRockCount: getKnownRocks(world).length, fingerprints,
  limitations: ["Static rate estimates are diagnostic, not measured throughput.",
    "This original save alone cannot establish coverage of absent colony voyages or absent recipes.",
    "Quarry probes inspect source/consumer consistency, not worker access or successful hauling."] };
await write("audit.json", audit);
console.error(`Validated ${audit.buildings} buildings/${audit.actors} actors; ${audit.dimensions.join("x")} map`);
if (process.env.AUDIT_ONLY === "1") process.exit(0);

const universe = new Set<string>(buildings.flatMap(building => building.recipe?.outputs ?? []));
const schema = offlineProductionSchema(offlineProductionIslands(source).values());
const groupProduction = (goods: Goods, production: Iterable<BuildingProduction>) => schema.hasMetalworks
  ? groupMetalworksProduction(goods, [...production], metalworksToolWares, schema.otherOutputs) : { ...goods };
const recordProduction = (target: Map<string, BuildingProduction>, entry: BuildingProduction) => {
  const key = `${entry.islandId}:${entry.uid}`, previous = target.get(key) ?? { ...entry, produced: {} };
  for (const [ware, count] of Object.entries(entry.produced)) add(previous.produced, ware, count);
  target.set(key, previous);
};
const exactBuildingProduction = new Map<string, BuildingProduction>();
const exactOutputs: Goods = {}, exactInputs: Goods = {}, exactByBuilding: Record<number, Goods> = {};
let lastProgress = performance.now();
const exactStart = performance.now();
console.error(`Starting independent exact ${exactSeconds}s reference`);
const exact = await advanceOfflineGame(source, source.savedAt + exactSeconds * 1000, progress => {
  if (performance.now() - lastProgress >= 15_000) {
    console.error(`Exact ${progress.completedSeconds.toFixed(0)}/${progress.totalSeconds}s`);
    lastProgress = performance.now();
  }
}, { exact: true, eventCore: false, onProductionCycle: (island, building, consumed, ware) => {
  if (ware) {
    add(exactOutputs, ware); add(exactByBuilding[building.uid] ??= {}, ware); universe.add(ware);
    recordProduction(exactBuildingProduction, { islandId: String(island ?? "home"), uid: building.uid,
      typeId: building.typeId, produced: { [ware]: 1 } });
  }
  for (const [input, count] of Object.entries(consumed)) add(exactInputs, input, count);
} });
const exactWallMs = performance.now() - exactStart;
const reference = { inputHash, seconds: exactSeconds, wallMs: exactWallMs,
  outputs: exactOutputs, inputs: exactInputs, byBuilding: exactByBuilding,
  buildingProduction: [...exactBuildingProduction.values()],
  finalStock: stock(exact), savedAt: exact.savedAt };
await write("exact-reference.json", reference);
await write("exact-final.json", exact);
await stageGameSession(exact);
console.error(`Exact completed in ${Math.round(exactWallMs)}ms; final save validates`);
if (process.env.EXACT_ONLY === "1") process.exit(0);

const runs: unknown[] = [];
for (const seconds of new Set([300, exactSeconds, 86400])) {
  const produced: Goods = {}, started = performance.now();
  const buildingProduction = new Map<string, BuildingProduction>();
  const progressLog: unknown[] = [];
  try {
    const result = await advanceOfflineGame(source, source.savedAt + seconds * 1000, progress => {
      if (progressLog.length < 10 || performance.now() - lastProgress >= 15_000) {
        progressLog.push({ ...progress, wallMs: performance.now() - started });
        lastProgress = performance.now();
      }
    }, { economy: true, onProductionCycle: (island, building, _consumed, ware) => {
      if (!ware) return;
      add(produced, ware);
      recordProduction(buildingProduction, { islandId: String(island ?? "home"), uid: building.uid,
        typeId: building.typeId, produced: { [ware]: 1 } });
    },
      onEconomyMetrics: metrics => {
        for (const island of metrics.production)
          for (const [ware, count] of Object.entries(island.produced)) add(produced, ware, count);
        for (const entry of metrics.buildingProduction ?? []) recordProduction(buildingProduction, entry);
      } });
    const wallMs = performance.now() - started;
    const stagingStart = performance.now();
    await stageGameSession(result);
    const stageMs = performance.now() - stagingStart;
    const groupedExact = groupProduction(exactOutputs, exactBuildingProduction.values());
    const groupedCandidate = groupProduction(produced, buildingProduction.values());
    const groupedUniverse = [...universe].filter(ware =>
      !schema.hasMetalworks || !metalworksToolWares.has(ware) || schema.otherOutputs.has(ware));
    const rows = seconds === exactSeconds
      ? [...new Set([...groupedUniverse, ...Object.keys(groupedExact), ...Object.keys(groupedCandidate)])].sort().map(ware => {
      const expected = groupedExact[ware] ?? 0, actual = groupedCandidate[ware] ?? 0;
      return { ware, exact: expected, candidate: actual, difference: actual - expected,
        percent: expected ? 100 * (actual - expected) / expected : null,
        active: !!expected || !!actual, pass: actual >= Math.ceil(.6 * expected) && actual <= Math.floor(1.1 * expected) };
    }) : undefined;
    runs.push({ seconds, completed: true, wallMs, stageMs, recoveryAndStageMs: wallMs + stageMs,
      within30Seconds: wallMs + stageMs <= 30_000, produced, buildingProduction: [...buildingProduction.values()],
      rows, finalStock: stock(result) });
    await write(`candidate-${seconds}s-final.json`, result);
    console.error(`Candidate ${seconds}s completed in ${Math.round(wallMs)}ms`);
  } catch (error) {
    runs.push({ seconds, completed: false, wallMs: performance.now() - started,
      error: error instanceof Error ? error.stack : String(error), progressLog,
      prefixOnlyOutputs: produced, accuracy: "Unavailable: no completed candidate save" });
    console.error(`Candidate ${seconds}s failed: ${String(error)}`);
  }
  await write("comparison.json", { inputHash, exact: reference, runs,
    scope: "Original save with no edited stocks, roads, actors, timestamps or stripped islands. Node simulation only; excludes UI/GPU/startup.",
    sourceUnchanged: digest(await readFile(sourcePath)) === inputHash,
    inMemorySourceUnchanged: digest(JSON.stringify(source)) === digest(JSON.stringify(JSON.parse(bytes.toString("utf8")))),
    acceptance: "Per active ware, except total completed Metalworks tools: ceil(60% exact)..floor(110% exact). Armory weapons stay separate. Exact-zero rows reported separately; no0/0 pass inflates active coverage." });
}
await write("implementation-end.json", await Promise.all(fingerprints.map(async entry => ({ ...entry,
  finalSha256: digest(await readFile(entry.path)) }))));
console.error(`Reports saved to ${dirname(resolve(output, "comparison.json"))}`);
