import { readFileSync } from "node:fs";

import type { MapRegion } from "../../../island-of-settlers-shared/src/campaign/campaign-regions";
import { mapScriptHash } from "../../../island-of-settlers-shared/src/script/hash";
import type { MapScript, ScriptEvent, ScriptTrigger } from "../../../island-of-settlers-shared/src/script/types/index";
import { TICK_SECONDS } from "../../../island-of-settlers-shared/src/time/constants";
import { createHeadlessIsland } from "../../src/app/settlement/headless-replay";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { hashSettlementState } from "../../src/shared/settlement/settlement-state-hash";
import { applyMixedFixture, tickFixtureOf, tickFixtureSave } from "./settlement-tick-fixtures";

/**
 * TRG3a gate: what a map script costs per fixed tick on the owner/mixed/scaled fixtures. Three variants run
 * back to back per round: no script (the master path), an empty script (engine + adapter, nothing subscribed) and
 * a 50-trigger script listening to the unit/building kinds of this lane (kills, damage with thresholds, doors,
 * jobs, production, construction, appear/gone, a 1 s periodic). TRG4 adds a fourth: 200 watched regions tiled over
 * the island with an enter and a leave trigger each (400 triggers, any player). TRG3b adds `nature`: the nature
 * kinds (tree cut/planted/stage, stone, deposit, shell, hunt) plus deer enter/leave triggers on four regions,
 * which pin their habitat regions awake (so the wildlife simulation of that variant differs by design). EXT-EVENTS
 * adds `economy`: production per ware (catalog ware references), upgrades, construction, destruction and the three
 * trade kinds. TRG4b adds `proximity`: "came near" circles of radius 4 and 8 around every building (static
 * auto-circles), around five building types, around the unit the script stored last (a moving target, two radii)
 * and bridge steps. Unprofiled wall time per tick; the no-script hash must equal across rounds.
 *
 * Usage: npx tsx tools/bench/script-tick-cost.ts <save.json> [seconds=60] [owner|mixed|scaled] [rounds=2]
 *   [variants=none,empty,fifty,regions,nature,economy,proximity]
 */

const [file, secondsArgument, fixtureArgument, roundsArgument, variantsArgument] = process.argv.slice(2);
if (!file) throw new Error("Usage: script-tick-cost.ts <save.json> [seconds] [owner|mixed|scaled] [rounds]");
const seconds = Number(secondsArgument ?? 60);
const fixture = tickFixtureOf(fixtureArgument);
const rounds = Number(roundsArgument ?? 2);
const save = JSON.parse(readFileSync(file, "utf8")) as GameSaveV1;

const ref = <K extends string>(kind: K, id: string) => ({ id, k: "ref" as const, kind });
const num = (value: number) => ({ k: "lit" as const, type: "number" as const, value });
const str = (value: string) => ({ k: "lit" as const, type: "string" as const, value });
const any = { kind: "any" as const };
const player1 = { faction: 0, kind: "slot" as const };
const ofType = (id: string) => ({ kind: "type", type: { type: ref("content", id) } });
const ofFamily = (id: string, faction?: number) =>
  ({ family: ref("family", id), kind: "family", ...(faction === undefined ? {} : { owner: { faction, kind: "slot" } }) });

const SOLDIERS = ["soldier:shield", "soldier:heavy", "soldier:archer", "soldier:cavalry", "settler:carrier"];
const JOBS = ["settler:carrier", "settler:builder", "settler:woodcutter", "settler:stonemason", "settler:farmer"];
const WARES = ["planks", "logs", "stone", "bread", "flour"];
const BUILDINGS = ["building:headquarters", "building:woodcutter", "building:sawmill", "building:stonemason",
  "building:storehouse"];

/** Fifty listening triggers; each increases its own counter. */
const fiftyEvents = (): ScriptEvent[] => [
  ...SOLDIERS.flatMap(type => [
    { kind: "actorKilled", player: any, slots: { killer: ofFamily("soldier", 0), victim: ofType(type) } },
    { kind: "actorKilled", player: player1, slots: { victim: ofType(type) } }
  ]),
  ...[20, 40, 60, 80, 90].flatMap(percent => [
    { kind: "actorDamaged", player: any, slots: { percent: num(percent), source: ofFamily("soldier", 0) } },
    { kind: "actorDamaged", player: player1, slots: { percent: num(percent) } }
  ]),
  ...BUILDINGS.map(type => ({ kind: "enteredBuilding", player: player1, slots: { building: ofType(type) } })),
  ...JOBS.map(type => ({ kind: "jobAssigned", player: player1, slots: { settler: ofType(type) } })),
  ...WARES.map(ware => ({ kind: "wareProduced", player: player1, slots: { ware: str(ware) } })),
  ...BUILDINGS.slice(0, 3).map(type => ({ kind: "constructionCompleted", player: player1,
    slots: { building: ofType(type) } })),
  { kind: "constructionPlaced", player: player1, slots: {} },
  { kind: "leftBuilding", player: player1, slots: {} },
  { kind: "actorAppeared", player: any, slots: { subject: ofFamily("settler") } },
  { kind: "actorGone", player: any, slots: {} },
  ...[1, 2, 3, 5, 7].map(period => ({ kind: "periodic", player: any, slots: { seconds: num(period) } }))
] as unknown as ScriptEvent[];

const counterTrigger = (event: ScriptEvent, index: number): ScriptTrigger => ({
  actions: [{ args: { amount: num(1), variable: ref("variable", `v${index}`) }, id: "s1", k: "do",
    op: "increaseVariable" }],
  concurrency: "queue", conditions: { k: "all", of: [] }, enabled: true, events: [event], folderId: null,
  id: `t${index}`, name: `t${index}`, runLimit: null
}) as ScriptTrigger;

/** TRG4 stress: a 20 × 10 grid of 6 × 6 rectangles over the map, each with an enter and a leave counter. */
const REGION_COLUMNS = 20;
const REGION_ROWS = 10;
const REGION_SIZE = 6;

const regionGrid = (cellsX: number, cellsZ: number): MapRegion[] =>
  Array.from({ length: REGION_COLUMNS * REGION_ROWS }, (_, index) => {
    const minX = Math.floor((index % REGION_COLUMNS + .2) * cellsX / REGION_COLUMNS);
    const minZ = Math.floor((Math.floor(index / REGION_COLUMNS) + .2) * cellsZ / REGION_ROWS);
    return { id: `region-${index}`, name: `r${index}`,
      shape: { kind: "rect", maxX: minX + REGION_SIZE, maxZ: minZ + REGION_SIZE, minX, minZ } };
  });

const regionEvents = (regions: readonly MapRegion[]): ScriptEvent[] => regions.flatMap(region =>
  (["enteredRegion", "leftRegion"] as const).map(kind =>
    ({ kind, player: any, slots: { region: ref("region", region.id) } }))) as unknown as ScriptEvent[];

const scriptWith = (events: ScriptEvent[], regions: MapRegion[] = []): MapScript => ({
  actors: [], cameraShots: [], folders: [], homeRewards: [],
  nextIds: { actor: 0, folder: 0, region: 0, reward: 0, trigger: events.length, variable: events.length },
  quests: { daily: "off", dailyResetUtcMinutes: 0, groups: [], id: "bench-book", quests: [], revision: 1, version: 1 },
  regions, revision: 1, scriptUid: "bench", sequences: [], triggers: events.map(counterTrigger),
  variables: events.map((_, index) => ({ id: `v${index}`, initial: { type: "number", value: 0 }, name: `v${index}`,
    type: "number" })), version: 1
}) as MapScript;

/** TRG3b: every nature kind once, plus deer enter/leave on four 12 × 12 regions (wildlife pins). */
const natureEvents = (regions: readonly MapRegion[]): ScriptEvent[] => [
  { kind: "treeCut", player: player1, slots: {} },
  { kind: "treePlanted", player: any, slots: {} },
  { kind: "treeGrowthStage", player: any, slots: {} },
  { kind: "stonePickedUp", player: any, slots: {} },
  { kind: "depositMined", player: any, slots: { region: ref("region", regions[0]!.id) } },
  { kind: "shellPickedUp", player: player1, slots: { shell: ofType("shell:seaStar") } },
  { kind: "animalKilled", player: player1, slots: { victim: ofFamily("animal.deer") } },
  { kind: "actorGone", player: { kind: "neutral" }, slots: {} },
  ...regions.flatMap(region => (["enteredRegion", "leftRegion"] as const).map(kind =>
    ({ kind, player: any, slots: { region: ref("region", region.id), subject: ofFamily("animal") } })))
] as unknown as ScriptEvent[];

const natureRegions = ({ cellsX, cellsZ }: MapSize): MapRegion[] => [[.25, .25], [.75, .25], [.25, .75], [.75, .75]]
  .map(([u, v], index) => {
    const minX = Math.floor(u! * cellsX) - 6, minZ = Math.floor(v! * cellsZ) - 6;
    return { id: `nature-${index}`, name: `n${index}`,
      shape: { kind: "rect", maxX: minX + 12, maxZ: minZ + 12, minX, minZ } };
  });

/** EXT-EVENTS: produced batches of twelve wares, building lifecycle kinds and every trade kind. */
const ECONOMY_WARES = ["planks", "logs", "stone", "bread", "flour", "water", "fish", "grain", "iron", "coal", "meat",
  "tool"];
const economyEvents = (): ScriptEvent[] => [
  ...ECONOMY_WARES.map(ware => ({ kind: "wareProduced", player: player1,
    slots: { ware: ref("content", `ware:${ware}`) } })),
  { kind: "wareProduced", player: any, slots: {} },
  ...[2, 3, 4, 5].map(level => ({ kind: "buildingUpgraded", player: player1, slots: { level: num(level) } })),
  { kind: "constructionCompleted", player: any, slots: {} },
  { kind: "buildingDestroyed", player: any, slots: { cause: str("demolished") } },
  { kind: "buildingDestroyed", player: any, slots: { cause: str("destroyed") } },
  ...["planks", "stone", "fish"].flatMap(ware => (["wareBought", "wareSold", "tradeDeliveryArrived"] as const)
    .map(kind => ({ kind, player: player1, slots: { ware: ref("content", `ware:${ware}`) } }))),
  { kind: "tradeDeliveryArrived", player: any, slots: { trade: str("purchase") } }
] as unknown as ScriptEvent[];

/** TRG4b: circles around every building and five types, a moving target in an actor variable, bridge steps. */
const MOVING_TARGET = "a-target";
const movingTarget = { kind: "variable", variable: ref("variable", MOVING_TARGET) };
const proximityEvents = (): ScriptEvent[] => [
  ...[4, 8].map(radius => ({ kind: "cameNear", player: any,
    slots: { radius: num(radius), target: ofFamily("building", 0) } })),
  ...BUILDINGS.map(type => ({ kind: "cameNear", player: player1, slots: { radius: num(6), target: ofType(type) } })),
  ...[2, 6].map(radius => ({ kind: "cameNearMoving", player: any,
    slots: { radius: num(radius), target: movingTarget } })),
  { kind: "bridgeStepped", player: any, slots: {} }
] as unknown as ScriptEvent[];

/** The proximity script: the counters plus one trigger that keeps the latest approaching unit as the target. */
const proximityScript = (): MapScript => {
  const events = proximityEvents(), script = scriptWith(events);
  const keeper = { ...counterTrigger(events[0]!, events.length), actions: [{ args: { mode: str("replace"),
    selector: { key: "enteringActor", kind: "response" }, variable: ref("variable", MOVING_TARGET) }, id: "s1",
  k: "do", op: "storeActor" }] } as ScriptTrigger;
  return { ...script, triggers: [...script.triggers, keeper], variables: [...script.variables,
    { id: MOVING_TARGET, initial: { type: "actor", value: [] }, name: MOVING_TARGET, type: "actor" }] };
};

const VARIANTS = ["none", "empty", "fifty", "regions", "nature", "economy", "proximity"] as const;
type Variant = (typeof VARIANTS)[number];
type MapSize = { cellsX: number; cellsZ: number };
const SCRIPTS: Record<Variant, (size: MapSize) => MapScript | undefined> = {
  economy: () => scriptWith(economyEvents()), empty: () => scriptWith([]), fifty: () => scriptWith(fiftyEvents()),
  none: () => undefined,
  nature: size => {
    const regions = natureRegions(size);
    return scriptWith(natureEvents(regions), regions);
  },
  proximity: proximityScript,
  regions: ({ cellsX, cellsZ }) => {
    const regions = regionGrid(cellsX, cellsZ);
    return scriptWith(regionEvents(regions), regions);
  }
};

/** The fixture island running its variant's script from its first tick (attached as at a map start). */
const islandWith = async (variant: Variant) => {
  const island = await createHeadlessIsland(tickFixtureSave(save, fixture));
  for (const _progress of island.simulation.prewarmCoastalGeometry()) { /* Derived caches only. */ }
  // Every variant reloads once, so the post-load cache rebuild lands in all of them alike.
  const script = SCRIPTS[variant](island.world);
  const settlement = island.simulation.saveState();
  if (script) {
    island.world.script = script;
    settlement.scriptSnapshot = { revision: script.revision, scriptHash: mapScriptHash(script) };
  }
  const loaded = island.simulation.loadState(settlement);
  if (!loaded.ok) throw new Error(loaded.reason);
  if (fixture === "mixed") applyMixedFixture(island.simulation);
  return island;
};

const percentile = (sorted: number[], fraction: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;

/** Ticks after a load that rebuild derived caches; the steady mean skips them. */
const WARM_UP_TICKS = 40;

/** Wall time inside the script's end-of-tick work (unit watch + engine), measured around the adapter call. */
const timeScriptEndTick = (island: Awaited<ReturnType<typeof islandWith>>) => {
  const script = island.simulation.script();
  const timing = { ms: 0 };
  if (!script) return timing;
  const endTick = script.endTick;
  script.endTick = () => {
    const started = performance.now();
    endTick();
    timing.ms += performance.now() - started;
  };
  return timing;
};

const run = async (variant: Variant) => {
  const island = await islandWith(variant);
  const scriptTime = timeScriptEndTick(island);
  const tickMs: number[] = [];
  for (let tick = 0; tick < Math.round(seconds / TICK_SECONDS); tick++) {
    const started = performance.now();
    island.simulation.update(TICK_SECONDS);
    tickMs.push(performance.now() - started);
  }
  const steady = tickMs.slice(WARM_UP_TICKS);
  const sorted = [...steady].sort((a, b) => a - b);
  const engine = island.simulation.script()?.engine;
  const fires = Object.values(engine?.state.firedCounts ?? {}).reduce((sum, count) => sum + count, 0);
  return {
    fires,
    people: island.simulation.frames().length,
    hash: variant === "none" ? hashSettlementState({ runtime: island.runtimeState(),
      settlement: island.simulation.saveState(), world: island.world }) : undefined,
    p95TickMs: Number(percentile(sorted, .95).toFixed(2)),
    scriptEndTickMsPerTick: Number((scriptTime.ms / tickMs.length).toFixed(4)),
    steadyMeanTickMs: Number((steady.reduce((sum, value) => sum + value, 0) / steady.length).toFixed(3)),
    variant
  };
};

const chosenVariants = variantsArgument
  ? VARIANTS.filter(variant => variantsArgument.split(",").includes(variant)) : VARIANTS;
const results: Awaited<ReturnType<typeof run>>[] = [];
for (let round = 0; round < rounds; round++)
  for (const variant of chosenVariants) results.push(await run(variant));
console.log(JSON.stringify({ fixture, results, rounds, simulatedSeconds: seconds }, null, 2));
