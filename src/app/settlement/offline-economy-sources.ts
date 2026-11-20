import { refreshCanopyField } from "../../render-common/canopy-field";
import { createTreeGrowth } from "../../render-common/growth/tree-growth";
import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { TREE_GROWTH_SECONDS } from "../../shared/balance/economy";
import { MARBLE_DEPOSIT_QUANTITY, STONE_SOURCE_REST_SECONDS } from "../../shared/balance/resources";
import { isMaterialQuarry, MATERIAL_BUILDING_GROUPS, materialBuildingGroup } from "../../shared/settlement/advanced-material-production";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { FORESTER_PLANT_SECONDS } from "../../shared/settlement/outdoor-work-timing";
import { createRoadNetwork } from "../../shared/settlement/road-network";
import { flushSavedOccupancy, savedOccupancy } from "../../shared/settlement/save-cell-codecs";
import { isFishingCastWet } from "../../shared/settlement/settlement-fishing";
import { resourceApproaches } from "../../shared/settlement/settlement-resource-approaches";
import { canPlantAt, freshResourceAmount, TREE_TYPES } from "../../shared/settlement/settlement-resources";
import { countSaveIntegrity } from "../../shared/settlement/settlement-save-integrity";
import type { ResourceTarget, SettlementBuilding, SettlementContext, SettlementPoint } from "../../shared/settlement/settlement-types";
import { resourceWorkRadius } from "../../shared/settlement/settlement-work-ranges";
import { placeProp, restoreRemovedProp } from "../../shared/world/editing/prop-placement";
import { removePropsAt } from "../../shared/world/editing/prop-removal";
import { createPlantedTreeSpecies } from "../../shared/world/editing/tree-planting";
import { createStatefulRandom, shuffle } from "../../shared/world/rng";
import { bumpBuildRevision } from "../../shared/world/save/world-change-journal";
import { ORE, PROP, type WorldData } from "../../shared/world/world-data";
import { removeHarvestedTree } from "../island-tree-removal";
import type { GameRuntimeState } from "./game-session";
import { createIslandStoneDeposits } from "./island-stone-deposits";
import type { OfflineEconomyJob } from "./offline-economy-events";
import { OFFLINE_ECONOMY_TICKS_PER_SECOND } from "./offline-economy-rates";
import { prepareOfflineQuarrySources } from "./offline-quarry-sources";
import { DMath } from "../../shared/math/deterministic-math";

interface Part {
  units: number;
  spend: (units: number) => void;
  renewal?: { quantum: number; reset: (remaining: number) => void };
  retainedForWork?: boolean;
  availableAt?: number;
  treeId?: number;
  availabilityKey?: string;
  identityKey?: string;
}
interface Replant {
  key: string; stump?: string; planted: string; mature: string; harvestStump?: string;
  x: number; z: number; kind: number; seed: number; randomState: number; harvested: boolean;
}
export interface OfflineEconomySources {
  stock: Record<string, number>;
  capacities: Record<string, number>;
  jobs: OfflineEconomyJob[];
  /** Source identities in the deterministic harvest ledger; renewed generations have no initial prop id. */
  treeHarvestOrder: Record<string, (number | null)[]>;
  /** Exact original prop identities for choice-token harvest receipts; new generations have no initial prop. */
  treeIdsByToken: Record<string, number>;
  apply: (consumed: Record<string, number>, finalStock?: Record<string, number>, produced?: Record<string, number>) => void;
  notes: string[];
  resetCompleted: () => void;
  onCompleted: ReturnType<typeof prepareOfflineQuarrySources>["onCompleted"];
}
const refreshPlantedCanopy = (world: WorldData, point: SettlementPoint) =>
  refreshCanopyField(world, { minX: Math.max(0, Math.floor(point.x) - 3),
    maxX: Math.min(world.cellsX - 1, Math.floor(point.x) + 3),
    minZ: Math.max(0, Math.floor(point.z) - 3), maxZ: Math.min(world.cellsZ - 1, Math.floor(point.z) + 3) });
const validateTreeIdentities = (pools: Map<string, Part[]>, consumed: Record<string, number>) => {
  for (const [key, parts] of pools) if (parts.some(part => part.identityKey)) {
    const used = parts.reduce((sum, part) => sum + (consumed[part.identityKey!] ?? 0), 0);
    if (parts.some(part => !part.identityKey) || used !== (consumed[key] ?? 0))
      throw new Error(`Offline tree identity balance invalid: ${key}`);
  }
};
const spendParts = (key: string, parts: Part[], consumed: Record<string, number>, produced: Record<string, number>, regrown: number) => {
  if (parts.some(part => part.identityKey)) {
    for (const part of parts) { const used = consumed[part.identityKey!] ?? 0; if (used) part.spend(used); }
    return;
  }
  let left = consumed[key] ?? 0, grown = (produced[key] ?? 0) - regrown;
  for (const part of parts) {
    if (part.availabilityKey && !produced[part.availabilityKey]) continue;
    if (part.availableAt !== undefined && !part.availabilityKey && grown-- <= 0) continue;
    const used = Math.min(left, part.units); if (used) part.spend(used); left -= used;
  }
  if (left) throw new Error(`Offline finite source identity unavailable: ${key}`);
};

const prepareFiniteReplants = (options: {
  save: GameSaveV1; world: WorldData; jobs: OfflineEconomyJob[]; pools: Map<string, Part[]>;
  stock: Record<string, number>; sourceJobs: OfflineEconomyJob[]; reserved: Set<string>;
  reachable: (building: SettlementBuilding, point: SettlementPoint) => boolean; seconds: number; notes: string[];
}) => {
  const { jobs, notes, pools, reachable, reserved, save, seconds, sourceJobs, stock, world } = options;
  const state = save.settlement, runtime = save.runtime as GameRuntimeState | undefined;
  const replants: Replant[] = [], auxiliary = new Set<string>(), treeIdsByToken: Record<string, number> = {};
  for (const parts of pools.values()) parts.sort((a, b) => (a.availableAt ?? 0) - (b.availableAt ?? 0));
  const foresters = state.buildings.filter(building => building.construction === 1 &&
    building.worker !== undefined && !building.productionPaused && (building.typeId === 20 ||
      MATERIAL_BUILDING_GROUPS.some(group => group.forester === building.typeId)));
  if (!runtime?.growth || seconds <= TREE_GROWTH_SECONDS / runtime.growth.speed || foresters.length !== 1)
    return { auxiliary, replants, treeIdsByToken };
  const forester = foresters[0]!, group = materialBuildingGroup(forester.typeId);
  const key = `~tree:${group?.woodcutter ?? 17}`, parts = pools.get(key) ?? [];
  const cutters = jobs.filter(job => key in job.inputs), cutter = cutters[0];
  const cutterBuilding = state.buildings.find(building => `building:${building.uid}` === cutter?.uid);
  if (cutters.length !== 1 || !cutter || cutter.outputSequence || cutter.inputs[key] !== 1 || !cutterBuilding)
    return { auxiliary, replants, treeIdsByToken };
  const sourceEndTick = cutter.endTick;
  const plannedWorld = structuredClone(world), roads = createRoadNetwork(plannedWorld);
  if (!roads.replaceSegments(state.roads)) throw new Error("Invalid offline forestry roads");
  const fieldCells = new Set(state.fields.filter(field => field.state !== "stubble")
    .map(field => Math.floor(field.z) * world.cellsX + Math.floor(field.x)));
  const context = { options: { world: plannedWorld, roads }, buildings: state.buildings,
    occupied: savedOccupancy(state), reservations: reserved,
    fieldCycles: { isOccupied: (x: number, z: number) => fieldCells.has(Math.floor(z) * world.cellsX + Math.floor(x)) }
  } as unknown as SettlementContext;
  const allowed = (x: number, z: number) =>
    DMath.hypot(x - cutterBuilding.x, z - cutterBuilding.z) <= resourceWorkRadius("tree") &&
    DMath.hypot(x - forester.x, z - forester.z) <= resourceWorkRadius("plant") &&
    !reserved.has(`plant:${Math.floor(z) * world.cellsX + Math.floor(x)}`) &&
    canPlantAt(context, x, z) && reachable(forester, { x, z });
  const candidates: { part?: Part; id: string; x: number; z: number }[] = [];
  for (const part of parts) {
    if (part.availableAt !== undefined || part.treeId === undefined) continue;
    const id = part.treeId, x = Math.floor(world.props.x[id]!) + .5, z = Math.floor(world.props.z[id]!) + .5;
    removeHarvestedTree(plannedWorld, {} as TerrainRenderer, id);
    if (allowed(x, z)) candidates.push({ part, id: String(id), x, z });
    // Nearest-source selection can leave every other original tree standing. Validate the nursery
    // spot with only its own stump cleared, rather than assuming an old-first harvest prefix.
    restoreRemovedProp(plannedWorld, id, world.props.types[id]!);
  }
  // Empty legal sites remain available even when one or more original trees can be replanted.
  // Treating them as a fallback capped a single reusable stump at the whole nursery's output.
  // Earlier modeled harvests must not manufacture initial empty sites, so restore the original map.
  if (cutter.endTick === undefined || cutter.endTick > 0) {
    Object.assign(plannedWorld, structuredClone(world));
    for (let z = Math.max(0, Math.floor(forester.z - resourceWorkRadius("plant")));
      z < Math.min(world.cellsZ, forester.z + resourceWorkRadius("plant")); z++)
      for (let x = Math.max(0, Math.floor(forester.x - resourceWorkRadius("plant")));
        x < Math.min(world.cellsX, forester.x + resourceWorkRadius("plant")); x++)
        if (allowed(x + .5, z + .5))
          candidates.push({ id: `fresh:${z * world.cellsX + x}`, x: x + .5, z: z + .5 });
  }
  const random = createStatefulRandom(state.plantingRandomState), species = createPlantedTreeSpecies(world);
  const byPart = new Map<Part, Replant>(), freshTrees: { plan: Replant; id: number; generation: number }[] = [];
  // The nursery worker plants the validated candidate sites, not a maximum-radius point on every
  // generation. Their actual approach trip bounds how many renewals can fit the horizon.
  const localTrip = (x: number, z: number) => 2 * (DMath.hypot(x - forester.workerApproach.x,
    z - forester.workerApproach.z) + DMath.hypot(forester.workerApproach.x - forester.doorThreshold.x,
    forester.workerApproach.z - forester.doorThreshold.z)) / .9;
  const nearestTrip = candidates.length ? Math.min(...candidates.map(site => localTrip(site.x, site.z))) :
    2 * resourceWorkRadius("plant") / .9;
  const plantTicks = Math.ceil((nearestTrip + FORESTER_PLANT_SECONDS + 3) * OFFLINE_ECONOMY_TICKS_PER_SECOND);
  // Enough plans for a worker that keeps choosing the nearest available site; the event ledger
  // still charges every selected site's own approach trip, growth and the cutter cycle.
  const limit = Math.min(2048, Math.floor(seconds * OFFLINE_ECONOMY_TICKS_PER_SECOND / plantTicks));
  const growthTicks = Math.ceil(TREE_GROWTH_SECONDS / runtime.growth.speed * OFFLINE_ECONOMY_TICKS_PER_SECOND);
  const generations = Math.floor(seconds * OFFLINE_ECONOMY_TICKS_PER_SECOND /
    (plantTicks + growthTicks + cutter.cycleTicks)) + 1;
  const makePlan = (id: string, x: number, z: number, stump?: string): Replant => ({ key, stump,
    planted: `~planted:${id}`, mature: `~mature:${id}`, x, z,
    kind: group ? PROP[group.tree] : species(x, z), seed: world.seed + Math.round(x * 977 + z * 7919),
    randomState: random.getState(), harvested: false });
  while (candidates.length && replants.length < limit) {
    shuffle(candidates, random);
    const site = candidates.pop()!;
    if (site.part) removeHarvestedTree(plannedWorld, {} as TerrainRenderer, site.part.treeId!);
    if (!allowed(site.x, site.z)) {
      if (site.part) restoreRemovedProp(plannedWorld, site.part.treeId!, world.props.types[site.part.treeId!]!);
      continue;
    }
    const plan = makePlan(site.id, site.x, site.z, site.part ? `~stump:${site.id}` : undefined);
    const id = placeProp(plannedWorld, { ...plan, kind: plan.kind });
    if (typeof id !== "number") {
      if (site.part) restoreRemovedProp(plannedWorld, site.part.treeId!, world.props.types[site.part.treeId!]!);
      continue;
    }
    replants.push(plan);
    if (site.part) byPart.set(site.part, plan);
    // A harvested original site is reusable too; its first planting still waits for that exact
    // original stump, and every later generation waits for its own actual harvest.
    freshTrees.push({ plan, id, generation: 1 });
  }
  for (const { generation, id, plan } of freshTrees) {
    if (replants.length >= limit) break;
    if (generation >= generations) continue;
    removeHarvestedTree(plannedWorld, {} as TerrainRenderer, id);
    if (!allowed(plan.x, plan.z)) continue;
    plan.harvestStump = `~stump:${plan.planted}`;
    const again = makePlan(`generation:${replants.length}`, plan.x, plan.z, plan.harvestStump);
    const placed = placeProp(plannedWorld, { ...again, kind: again.kind });
    if (typeof placed !== "number") { plan.harvestStump = undefined; continue; }
    replants.push(again);
    freshTrees.push({ plan: again, id: placed, generation: generation + 1 });
  }
  if (!parts.length && !replants.length) return { auxiliary, replants, treeIdsByToken };
  cutter.sourceChoices = { input: key, choices: parts.map(part => {
    const id = part.treeId!, token = `~identity:tree:${id}`;
    part.identityKey = token; treeIdsByToken[token] = id; auxiliary.add(token);
    stock[token] = part.availableAt === undefined ? 1 : 0;
    const plan = byPart.get(part);
    return { token, priority: DMath.hypot(world.props.x[id]! - cutterBuilding.workerApproach.x,
      world.props.z[id]! - cutterBuilding.workerApproach.z), ...(plan?.stump ? { outputs: { [plan.stump]: 1 } } : {}) };
  }) };
  if (!replants.length) return { auxiliary, replants, treeIdsByToken };
  const nursery = `~nursery:${forester.uid}:worker`;
  const availableSites = `~nursery:${forester.uid}:sites`;
  stock[nursery] = 1; auxiliary.add(nursery);
  stock[availableSites] = 0; auxiliary.add(availableSites);
  const plantChoices: NonNullable<OfflineEconomyJob["sourceChoices"]>["choices"] = [];
  for (const plan of replants) {
    for (const token of [plan.stump, plan.planted, plan.mature, plan.harvestStump]) if (token) auxiliary.add(token);
    // All available sites compete for one real worker. An unavailable stump must not hold up a
    // different legal site merely because it appeared first in the projected shuffle.
    const siteTrip = localTrip(plan.x, plan.z);
    const cycleTicks = Math.max(1, Math.ceil((siteTrip + FORESTER_PLANT_SECONDS + 3) *
      OFFLINE_ECONOMY_TICKS_PER_SECOND));
    const site = plan.stump ?? `~site:${plan.planted}`;
    if (!plan.stump) { stock[site] = 1; auxiliary.add(site); stock[availableSites]!++; }
    plantChoices.push({ token: site, priority: siteTrip, cycleTicks, outputs: { [plan.planted]: 1 } });
    sourceJobs.push({ uid: `regrow:${plan.planted}`, islandId: cutter.islandId,
      cycleTicks: growthTicks,
      inputs: { [plan.planted]: 1 }, outputs: { [key]: 1, [plan.mature]: 1 },
      outputSequence: [{ [key]: 1, [plan.mature]: 1 }],
      ...(sourceEndTick === undefined ? {} : { endTick: sourceEndTick }) });
    cutter.sourceChoices.choices.push({ token: plan.mature,
      priority: DMath.hypot(plan.x - cutterBuilding.workerApproach.x, plan.z - cutterBuilding.workerApproach.z),
      ...(plan.harvestStump ? { outputs: { [plan.harvestStump]: 1 } } : {}) });
    parts.push({ units: 1, availableAt: Infinity, availabilityKey: plan.mature, identityKey: plan.mature,
      spend: () => { plan.harvested = true; } });
  }
  // One forester job selects an available site. Enqueuing a separate blocked job for every future
  // generation wakes O(generations²) retries on each worker return during a full-day recovery.
  for (const choice of cutter.sourceChoices.choices) if (Object.keys(choice.outputs ?? {})
    .some(key => key.startsWith("~stump:"))) choice.outputs![availableSites] = 1;
  sourceJobs.push({ uid: `plant:nursery:${forester.uid}`, islandId: cutter.islandId,
    cycleTicks: Math.max(...plantChoices.map(choice => choice.cycleTicks!)),
    inputs: { [nursery]: 1, [availableSites]: 1 }, outputs: { [nursery]: 1 },
    sourceChoices: { input: availableSites, choices: plantChoices },
    ...(sourceEndTick === undefined ? {} : { endTick: sourceEndTick }) });
  pools.set(key, parts);
  notes.push(`${key}: ${replants.length} finite nursery plantings from validated empty/harvested sites ` +
    `(nearest approach ${nearestTrip.toFixed(1)}s); ` +
    "sites reused only after their previous harvest, one worker, site-distance trips and separate growth. " +
    "Per-site generations and total nursery work are bounded by the horizon. Projected shuffle uses the saved " +
    "planting stream on a bounded candidate set; unripe new saplings resume conservatively from age zero.");
  return { auxiliary, replants, treeIdsByToken };
};

/**
 * A finite source ledger for the provisional economy lane. Sources are claimed once across all
 * overlapping work areas. Unreserved boulder/deposit pools replenish after actual exhaustion and
 * the authored rest interval. A single cutter can also reuse validated nursery sites, through
 * serialized real nursery work and the authored growth delay. Unknown replenishment is deferred.
 * The caller supplies detached save/world objects and completed (unfinished-work-refunded) usage.
 */
export const prepareOfflineEconomySources = (
  save: GameSaveV1, world: WorldData, jobs: OfflineEconomyJob[], seconds = 0
): OfflineEconomySources => {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid offline source horizon");
  const state = save.settlement, runtime = save.runtime as GameRuntimeState | undefined;
  const occupied = savedOccupancy(state);
  const stock: Record<string, number> = {}, notes: string[] = [];
  const pools = new Map<string, Part[]>(), claimed = new Set<string>();
  const maturations = new Map<string, { id: number; tick: number }[]>();
  const amounts = new Map(state.resourceAmounts);
  const targets = state.actors.flatMap(actor => [actor.target, actor.preparedTarget]
    .filter((target): target is ResourceTarget => !!target));
  const reserved = new Set([...state.reservations, ...targets.map(target => `${target.kind}:${target.id}`)]);
  const sourceKeys = new Set(jobs.flatMap(job => Object.keys(job.inputs).filter(key => key.startsWith("~"))));
  const add = (key: string, identity: string, units: number, spend: Part["spend"], renewal?: Part["renewal"], retainedForWork = false, treeId?: number) => {
    if (claimed.has(identity) || units <= 0) return;
    claimed.add(identity);
    const parts = pools.get(key) ?? [];
    parts.push({ units, spend, renewal, retainedForWork, treeId }); pools.set(key, parts);
    stock[key] = (stock[key] ?? 0) + units;
  };
  const restStone = (kind: "prop" | "deposit", id: number) => {
    state.stoneRespawns ??= [];
    if (!state.stoneRespawns.some(entry => entry.kind === kind && entry.id === id))
      state.stoneRespawns.push({ kind, id, restSeconds: 0 });
  };
  // One bounded terrain flood per building, shared by all of its source checks. This intentionally
  // excludes disconnected terrain; fine actor footprints and traffic remain approximate.
  const reach = new Map<number, Set<number>>();
  const reachable = (building: SettlementBuilding, point: SettlementPoint) => {
    let cells = reach.get(building.uid);
    if (!cells) {
      cells = new Set<number>(); reach.set(building.uid, cells);
      const origin = building.access, radius = resourceWorkRadius("wildlife") + 3;
      const first = Math.floor(origin.z) * world.cellsX + Math.floor(origin.x);
      const pending = [first]; cells.add(first);
      for (let index = 0; index < pending.length; index++) {
        const cell = pending[index]!, x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx!, nz = z + dz!, next = nz * world.cellsX + nx;
          if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ || cells.has(next) ||
            !world.walkCost[next] || occupied[next] === 1 ||
            DMath.hypot(nx + .5 - origin.x, nz + .5 - origin.z) > radius) continue;
          cells.add(next); pending.push(next);
        }
      }
    }
    return cells.has(Math.floor(point.z) * world.cellsX + Math.floor(point.x));
  };
  const accessible = (building: SettlementBuilding, target: ResourceTarget) =>
    resourceApproaches(target).some(point => reachable(building, point));
  const growing = new Set(runtime?.growth?.planted.map(([id]) => id) ?? []);
  const plantedAt = new Map(runtime?.growth?.planted ?? []);
  for (const id of runtime?.growth?.grown ?? []) growing.delete(id);
  const falling = new Set(runtime?.felling?.controller.fellings.map(([id]) => id) ?? []);
  const removedTrees = new Set<number>();
  let stone: ReturnType<typeof createIslandStoneDeposits> | undefined;
  const stoneLedger = () => stone ??= createIslandStoneDeposits(world, id => {
    removePropsAt(world, [id]); restStone("prop", id);
  }, runtime?.stone);
  const quarry = prepareOfflineQuarrySources({ save, world, jobs, seconds, ledger: stoneLedger,
    reserved, claimed, accessible });
  Object.assign(stock, quarry.stock);
  for (const key of sourceKeys) {
    stock[key] ??= 0;
    if (key.startsWith("~ore:")) {
      const building = state.buildings.find(building => building.uid === Number(key.slice(5)));
      if (!building || building.typeId < 10 || building.typeId > 13) continue;
      const ore = [ORE.granite, ORE.coal, ORE.iron, ORE.gold][building.typeId - 10];
      // Mines spend ore on completion, so retain one unit for their original paid actor cycle.
      let keep = state.actors.some(actor => actor.building === building.uid &&
        actor.productionSeconds !== undefined) ? 1 : 0;
      for (let z = building.z - building.depth / 2; z < building.z + building.depth / 2; z++)
        for (let x = building.x - building.width / 2; x < building.x + building.width / 2; x++) {
          const cell = z * world.cellsX + x;
          if (!world.oreAmount[cell] || world.mineZones.find(zone => zone.id === world.mineZone[cell])?.ore !== ore)
            continue;
          const held = Math.min(keep, world.oreAmount[cell]!); keep -= held;
          add(key, `ore:${cell}`, world.oreAmount[cell]! - held, units => { world.oreAmount[cell]! -= units; });
        }
      continue;
    }
    if (key.startsWith("~tree:")) {
      const typeId = Number(key.slice(6)), group = materialBuildingGroup(typeId);
      const cutters = state.buildings.filter(building => building.typeId === typeId &&
        building.construction === 1 && building.worker !== undefined && !building.productionPaused);
      for (let id = 0; id < world.props.count; id++) {
        const type = world.props.types[id]!;
        const species = group ? group.woodcutter === typeId && type === PROP[group.tree]
          : typeId === 17 && TREE_TYPES.has(type) && !MATERIAL_BUILDING_GROUPS.some(group => type === PROP[group.tree]);
        if (!species || world.props.scale[id]! < .7 || falling.has(id) ||
          reserved.has(`tree:${id}`)) continue;
        const target: ResourceTarget = { id, kind: "tree", x: world.props.x[id]!, z: world.props.z[id]! };
        if (!cutters.some(building => DMath.hypot(target.x - building.x, target.z - building.z) <=
          resourceWorkRadius("tree") && accessible(building, target))) continue;
        if (growing.has(id)) {
          const growth = runtime?.growth, start = plantedAt.get(id);
          if (!growth || start === undefined || seconds <= 0) continue;
          const tick = Math.max(0, Math.ceil((start + TREE_GROWTH_SECONDS / growth.speed - growth.now) *
            OFFLINE_ECONOMY_TICKS_PER_SECOND));
          if (tick > seconds * OFFLINE_ECONOMY_TICKS_PER_SECOND || claimed.has(`tree:${id}`)) continue;
          claimed.add(`tree:${id}`);
          const parts = pools.get(key) ?? [];
          parts.push({ units: 1, availableAt: tick, treeId: id, spend: () => { removedTrees.add(id); } }); pools.set(key, parts);
          const pending = maturations.get(key) ?? [];
          pending.push({ id, tick }); maturations.set(key, pending);
        } else add(key, `tree:${id}`, 1, () => { removedTrees.add(id); }, undefined, false, id);
      }
      notes.push(`${key}: finite existing trees and known maturation; supported harvested-site planting is bounded separately.`);
      continue;
    }
    if (!key.startsWith("~source:")) { notes.push(`${key}: unsupported finite source; production withheld.`); continue; }
    const building = state.buildings.find(building => building.uid === Number(key.slice(8)));
    if (!building) continue;
    if (building.typeId === 18) {
      // A saved chosen cast proves an actual site exists without re-running expensive shore search.
      for (const target of targets) {
        if (target.kind !== "fish" || !isFishingCastWet(world, target) || !target.approach ||
          DMath.hypot(target.x - building.x, target.z - building.z) > resourceWorkRadius("fish") ||
          !reachable(building, target.approach)) continue;
        const source = `fish:${target.id}`, left = amounts.get(source) ?? freshResourceAmount("fish");
        const available = Math.max(0, Math.floor(left) - Number(reserved.has(source)));
        add(key, source, available, units => { amounts.set(source, left - units); });
      }
      notes.push(`${key}: only saved validated fishing sites; fresh-site searches and replenishment deferred.`);
    } else if (building.typeId === 19 && world.colonyResourceTier === undefined && runtime) {
      notes.push(`${key}: shared physical stone identities; extraction completion starts each source's five-minute rest.`);
    } else if (isMaterialQuarry(building.typeId)) {
      const material = materialBuildingGroup(building.typeId)!.stone;
      for (const deposit of state.marbleDeposits ?? []) {
        const target: ResourceTarget = { id: -3_000_000 - deposit.id, kind: "stone", x: deposit.x, z: deposit.z };
        if ((deposit.material ?? "marble") !== material ||
          (deposit.sourceProp !== undefined && world.props.types[deposit.sourceProp] !== PROP.largeRock) ||
          DMath.hypot(deposit.x - building.access.x, deposit.z - building.access.z) > resourceWorkRadius("stone") ||
          !accessible(building, target)) continue;
        const held = reserved.has(`stone:${target.id}`);
        const setRemaining = (remaining: number) => {
          deposit.remaining = remaining;
          if (!deposit.remaining) {
            if (deposit.sourceProp !== undefined) removePropsAt(world, [deposit.sourceProp]);
            occupied[Math.floor(deposit.z) * world.cellsX + Math.floor(deposit.x)] = 0;
            restStone("deposit", deposit.id);
          } else {
            occupied[Math.floor(deposit.z) * world.cellsX + Math.floor(deposit.x)] = 1;
            state.stoneRespawns = state.stoneRespawns?.filter(entry => entry.kind !== "deposit" || entry.id !== deposit.id);
          }
        };
        add(key, deposit.sourceProp === undefined ? `deposit:${deposit.id}` : `prop:${deposit.sourceProp}`,
          deposit.remaining - Number(held), units => setRemaining(deposit.remaining - units), !held ? {
            quantum: MARBLE_DEPOSIT_QUANTITY, reset: setRemaining
          } : undefined, held);
      }
      notes.push(`${key}: existing matching material deposits; only unreserved pools can replenish.`);
    } else notes.push(`${key}: wildlife/unknown source state is deferred; production withheld.`);
  }
  const capacities: Record<string, number> = { ...quarry.capacities }, sourceJobs: OfflineEconomyJob[] = [...quarry.jobs];
  const { auxiliary, replants, treeIdsByToken } = prepareFiniteReplants({ save, world, jobs, pools, stock,
    sourceJobs, reserved, reachable, seconds, notes });
  for (const [key, pending] of maturations) {
    for (const { id, tick } of pending) {
      const token = pools.get(key)?.find(part => part.treeId === id)?.identityKey;
      const output = { [key]: 1, ...(token ? { [token]: 1 } : {}) };
      sourceJobs.push({ uid: `mature:${key}:${id}`, islandId: jobs.find(job => key in job.inputs)!.islandId,
        firstTick: tick, cycleTicks: 1, inputs: {}, outputs: output, outputSequence: [output] });
    }
  }
  const renewals = new Map<string, number>();
  for (const [key, original] of pools) {
    let parts = original;
    if (parts.some(part => part.renewal) && parts.every(part => part.renewal || part.retainedForWork)) {
      parts = parts.filter(part => part.renewal);
      if (parts.length !== original.length) {
        pools.set(key, parts); stock[key] = parts.reduce((sum, part) => sum + part.units, 0);
        notes.push(`${key}: sources owned by original saved work are retained in full while other sources replenish.`);
      }
    }
    if (!parts.every(part => part.renewal)) continue;
    const quantum = parts.reduce((sum, part) => sum + part.renewal!.quantum, 0);
    // Economic inputs reserve a source at start; live quarry extraction completes later. Delay
    // replenishment by the longest dependent work cycle as well as the physical source rest.
    const workTicks = Math.max(...jobs.filter(job => key in job.inputs).map(job => job.cycleTicks));
    capacities[key] = quantum; renewals.set(key, quantum);
    sourceJobs.push({ uid: `renew:${key}`, islandId: jobs.find(job => key in job.inputs)!.islandId,
      cycleTicks: STONE_SOURCE_REST_SECONDS * OFFLINE_ECONOMY_TICKS_PER_SECOND + workTicks,
      inputs: {}, outputs: { [key]: quantum } });
    notes.push(`${key}: unreserved quarry pool refills only when empty, after ${STONE_SOURCE_REST_SECONDS}s; ` +
      "pool sources share the slowest exhaustion boundary plus work latency; unfinished rest resumes conservatively at zero.");
  }
  notes.push("Source access uses terrain connectivity and work radii; fine movement/traffic is approximate.");
  let applied = false;
  const treeHarvestOrder = Object.fromEntries([...pools].filter(([key]) => key.startsWith("~tree:"))
    .map(([key, parts]) => [key, parts.flatMap(part => Array<number | null>(part.units).fill(part.treeId ?? null))]));
  return { stock, capacities, jobs: sourceJobs, treeHarvestOrder, treeIdsByToken, notes,
    resetCompleted: quarry.resetCompleted, onCompleted: quarry.onCompleted,
    apply: (consumed, finalStock, produced = {}) => {
    if (applied) throw new Error("Offline sources already applied");
    for (const plan of replants) {
      const planted = produced[plan.planted] ?? 0, mature = produced[plan.mature] ?? 0;
      if (mature > planted || (plan.stump && planted > (consumed[plan.stump] ?? 0)))
        throw new Error("Offline forestry planting balance invalid");
    }
    for (const key of auxiliary) {
      const made = produced[key] ?? 0, used = consumed[key] ?? 0;
      const workerToken = key.startsWith("~nursery:");
      if (!Number.isSafeInteger(made) || made < 0 || (!workerToken && made > 1) ||
        (finalStock && (stock[key] ?? 0) + made - used !== (finalStock[key] ?? 0)))
        throw new Error(`Offline forestry token balance invalid: ${key}`);
    }
    const replantKeys = new Set(replants.map(plan => plan.key));
    for (const [key, amount] of Object.entries(consumed)) if (key.startsWith("~") &&
      (!Number.isSafeInteger(amount) || amount < 0 || amount > (stock[key] ?? 0) +
        (renewals.has(key) || maturations.has(key) || auxiliary.has(key) || replantKeys.has(key) || quarry.managedKeys.has(key)
          ? produced[key] ?? 0 : 0)))
      throw new Error(`Offline finite source overdraw: ${key}`);
    for (const key of new Set([...maturations.keys(), ...replantKeys])) {
      const pending = maturations.get(key) ?? [];
      const made = produced[key] ?? 0;
      const regrown = replants.filter(plan => plan.key === key).reduce((sum, plan) => sum + (produced[plan.mature] ?? 0), 0);
      if (!Number.isSafeInteger(made) || made < regrown || made - regrown > pending.length ||
        (made > 0 && (!finalStock || !Number.isSafeInteger(finalStock[key]) || finalStock[key]! < 0 ||
          (stock[key] ?? 0) + made - (consumed[key] ?? 0) !== finalStock[key])))
        throw new Error(`Offline tree maturation balance invalid: ${key}`);
    }
    for (const [key, quantum] of renewals) {
      const made = produced[key] ?? 0;
      if (!Number.isSafeInteger(made) || made < 0 || made % quantum ||
        (made > 0 && (!finalStock || !Number.isSafeInteger(finalStock[key]) || finalStock[key]! < 0 ||
          finalStock[key]! > quantum || (stock[key] ?? 0) + made - (consumed[key] ?? 0) !== finalStock[key])))
        throw new Error(`Offline quarry renewal balance invalid: ${key}`);
    }
    validateTreeIdentities(pools, consumed);
    quarry.validate(consumed, finalStock, produced);
    applied = true;
    for (const [key, parts] of pools) {
      if (renewals.has(key) && (produced[key] ?? 0) > 0) {
        let used = renewals.get(key)! - finalStock![key]!;
        for (const part of parts) {
          const taken = Math.min(used, part.renewal!.quantum); used -= taken;
          part.renewal!.reset(part.renewal!.quantum - taken);
        }
        continue;
      }
      spendParts(key, parts, consumed, produced, replants.filter(plan => plan.key === key)
        .reduce((sum, plan) => sum + (produced[plan.mature] ?? 0), 0));
    }
    for (const id of removedTrees) {
      removeHarvestedTree(world, {} as TerrainRenderer, id); amounts.set(`tree:${id}`, 0);
    }
    if (runtime && removedTrees.size) {
      // Wildlife region counters are derived from the world on load: nothing to patch here.
      runtime.growth.trees = runtime.growth.trees.filter(id => !removedTrees.has(id));
      runtime.growth.grown = runtime.growth.grown.filter(id => !removedTrees.has(id));
      runtime.growth.jobPlanted = runtime.growth.jobPlanted.filter(id => !removedTrees.has(id));
      runtime.growth.planted = runtime.growth.planted.filter(([id]) => !removedTrees.has(id));
      runtime.growth.removed = runtime.growth.removed.filter(([id]) => !removedTrees.has(id));
      runtime.felling.fallYaws = runtime.felling.fallYaws.filter(([id]) => !removedTrees.has(id));
      runtime.felling.controller.fellings = runtime.felling.controller.fellings.filter(([id]) => !removedTrees.has(id));
    }
    quarry.apply(consumed, finalStock, produced);
    if (runtime && stone) runtime.stone = stone.saveState();
    if (runtime?.growth && seconds > 0) {
      const growth = createTreeGrowth([], 0, id => TREE_TYPES.has(world.props.types[id]!) && !falling.has(id));
      growth.loadState(runtime.growth);
      growth.update(runtime.growth.now + seconds);
      for (const plan of replants) if (produced[plan.planted]) {
        const id = placeProp(world, { x: plan.x, z: plan.z, kind: plan.kind, seed: plan.seed });
        if (typeof id !== "number") throw new Error("Offline forestry planted site changed");
        state.plantingRandomState = plan.randomState;
        if (plan.harvested) {
          removeHarvestedTree(world, {} as TerrainRenderer, id); amounts.set(`tree:${id}`, 0);
        } else {
          // Completion records do not retain intermediate times. Mature trees retain their full
          // age; an unfinished new sapling conservatively resumes from age zero at the final clock.
          growth.plant(id, produced[plan.mature] ? TREE_GROWTH_SECONDS : 0);
          refreshPlantedCanopy(world, plan);
        }
        bumpBuildRevision(world, null);
      }
      runtime.growth = growth.saveState();
    }
    state.resourceAmounts = [...amounts];
    flushSavedOccupancy(state);
    state.integrity = countSaveIntegrity(state);
  } };
};
