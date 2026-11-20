import { FLAX_FIELD_LIMIT, FLAX_GROWTH_SECONDS } from "../../shared/balance/economy";
import { DMath } from "../../shared/math/deterministic-math";
import { talentModifiers } from "../../shared/progression/talents";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { getBuildingProductionRule } from "../../shared/settlement/production-rules";
import { effectiveProductionSeconds } from "../../shared/settlement/production-timing";
import { createRoadNetwork } from "../../shared/settlement/road-network";
import { savedOccupancy } from "../../shared/settlement/save-cell-codecs";
import {
  DEFAULT_FARM_RADIUS, defaultWorkArea
} from "../../shared/settlement/settlement-farm-area";
import {
type FieldState,   fieldWorkStandOff, type SettlementFieldFrame
} from "../../shared/settlement/settlement-field-cycles";
import { createFieldSiteValidator } from "../../shared/settlement/settlement-field-sites";
import type {
  SettlementBuilding, SettlementContext
} from "../../shared/settlement/settlement-types";
import { WHEAT_SOW_SECONDS } from "../../shared/settlement/settlement-wheat-planning";
import { workshopCycleFactor } from "../../shared/settlement/workshop-upgrades";
import type { WorldData } from "../../shared/world/world-data";
import type { OfflineEconomyEventsResult, OfflineEconomyJob } from "./offline-economy-events";
import {
  OFFLINE_ECONOMY_TICKS_PER_SECOND as TPS, offlineFieldTripSeconds,
  offlineProductionTalentBonus, offlineStockTripSeconds
} from "./offline-economy-rates";

type Job = OfflineEconomyJob;
interface Tokens {
  drying: string; growing: string; initialGrowing: string; ripe: string; stubble: string;
}
interface FastPlot {
  added: boolean; cellId: number; farmUid: number; field: SettlementFieldFrame;
  initialProgress: number; tokens: Tokens; growthJob: string; initialGrowthJob: string; sowJob: string;
}
interface FastFarm {
  building: SettlementBuilding; growthTicks: number; plots: FastPlot[]; workerToken: string;
}
export interface OfflineEconomyFlaxPrepare {
  apply: (result: OfflineEconomyEventsResult, horizonTicks: number) => void;
  attachOutputAccounts: (accounts: ReadonlyMap<number, string>) => void;
  farms: number[];
  jobs: Job[];
  notes: string[];
  stock: Record<string, number>;
}
const own = (goods: Readonly<Record<string, number>>, ware: string) =>
  Object.hasOwn(goods, ware) ? goods[ware]! : 0;
const token = (farmUid: number, plot: number, phase: keyof Tokens) => `~flax:${farmUid}:${plot}:${phase}`;
const workerToken = (farmUid: number) => `~flax:${farmUid}:worker`;
const plotTokens = (farmUid: number, plot: number): Tokens => ({
  drying: token(farmUid, plot, "drying"), growing: token(farmUid, plot, "growing"),
  initialGrowing: token(farmUid, plot, "initialGrowing"), ripe: token(farmUid, plot, "ripe"),
  stubble: token(farmUid, plot, "stubble")
});
const add = (goods: Record<string, number>, ware: string, units: number) => {
  goods[ware] = own(goods, ware) + units;
  if (!Number.isSafeInteger(goods[ware]) || goods[ware]! < 0) throw new Error("Invalid flax ledger balance");
};

/** Saved plot geometry plus only legally available cells, bounded by the four-site crop limit. */
const farmPlots = (save: GameSaveV1, world: WorldData, building: SettlementBuilding,
  reservedCells: Set<number>) => {
  const state = save.settlement;
  const owned = state.fields.filter(field => field.owner === building.uid && field.kind === "flax");
  // The farm's own saved plots are authoritative even while its worker is currently targeting
  // one of them; excluding that field made a staffed farm look as if it had no legal flax plot.
  const saved = owned.slice(0, FLAX_FIELD_LIMIT);
  const plots: { added: boolean; cellId: number; field: SettlementFieldFrame }[] = saved.map(field => ({
    added: false, cellId: Math.floor(field.z) * world.cellsX + Math.floor(field.x), field
  }));
  if (owned.length >= FLAX_FIELD_LIMIT) return plots;
  const roads = createRoadNetwork(world);
  if (!roads.replaceSegments(state.roads)) return plots;
  const context = { options: { roads, world }, buildings: state.buildings,
    occupied: savedOccupancy(state).slice(), playerNation: state.playerNation,
    reservations: new Set(state.reservations) } as unknown as SettlementContext;
  const canUse = createFieldSiteValidator(context, state.fields);
  const area = defaultWorkArea(world, building, 8);
  const candidates: { id: number; x: number; z: number }[] = [];
  for (let z = area.minZ; z <= area.maxZ; z++) for (let x = area.minX; x <= area.maxX; x++) {
    const id = z * world.cellsX + x;
    if (reservedCells.has(id) || DMath.hypot(x + .5 - building.access.x, z + .5 - building.access.z) >
      DEFAULT_FARM_RADIUS - 1) continue;
    if (!canUse(x, z, undefined, true, 1.7)) continue;
    candidates.push({ id, x: x + .5, z: z + .5 });
  }
  candidates.sort((a, b) => DMath.hypot(a.x - building.access.x, a.z - building.access.z) -
    DMath.hypot(b.x - building.access.x, b.z - building.access.z) || a.id - b.id);
  const reachable = new Set<number>(), origin = building.workerApproach;
  const occupied = savedOccupancy(state);
  const first = Math.floor(origin.z) * world.cellsX + Math.floor(origin.x);
  const pending = [first];
  reachable.add(first);
  for (let index = 0; index < pending.length; index++) {
    const cell = pending[index]!, x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx!, nz = z + dz!, next = nz * world.cellsX + nx;
      if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ || reachable.has(next) ||
        !world.walkCost[next] || occupied[next] === 1 ||
        DMath.hypot(nx + .5 - origin.x, nz + .5 - origin.z) > 16) continue;
      reachable.add(next); pending.push(next);
    }
  }
  const room = FLAX_FIELD_LIMIT - owned.length;
  let added = 0;
  for (const candidate of candidates) {
    if (added >= room) break;
    if (!reachable.has(candidate.id)) continue;
    const field: SettlementFieldFrame = { id: candidate.id, owner: building.uid, kind: "flax",
      x: candidate.x, z: candidate.z, state: "stubble", progress: 0, step: 0 };
    plots.push({ added: true, cellId: candidate.id, field });
    reservedCells.add(candidate.id);
    added++;
  }
  return plots;
};

const growthRate = (save: GameSaveV1) => 1 + talentModifiers(save.player?.talents).fieldGrowthSpeed;
const actionSeconds = (building: SettlementBuilding, save: GameSaveV1, colony: boolean, kind: "collect" | "harvest" | "sow") => {
  const rule = getBuildingProductionRule(building, save.settlement.playerNation ?? "roman");
  const factor = workshopCycleFactor(building,
    offlineProductionTalentBonus(building.typeId, talentModifiers(save.player?.talents), colony));
  if (kind === "sow") return effectiveProductionSeconds(WHEAT_SOW_SECONDS, building.typeId, "flax") / factor;
  const harvest = effectiveProductionSeconds(rule?.seconds ?? 12, building.typeId, "flax") / factor;
  const rest = effectiveProductionSeconds(2, building.typeId, "flax") / factor;
  return harvest + rest + (kind === "collect" ? offlineStockTripSeconds(building, "output", "flax", save.settlement.playerNation) : 0);
};

/** One worker token, one plot token per phase and whole-crop output only. */
const createPlotJobs = (save: GameSaveV1, world: WorldData, farm: FastFarm, colony: boolean) => {
  const jobs: Job[] = [], building = farm.building;
  const travel = offlineFieldTripSeconds(save, world, building, fieldWorkStandOff("flax"),
    farm.plots.map(plot => plot.field)) ?? 2 * 8 / .9;
  const sowTicks = Math.max(1, Math.ceil((travel + actionSeconds(building, save, colony, "sow")) * TPS));
  const harvestTicks = Math.max(1, Math.ceil((travel + actionSeconds(building, save, colony, "harvest")) * TPS));
  const collectTicks = Math.max(1, Math.ceil((travel + actionSeconds(building, save, colony, "collect")) * TPS));
  for (const plot of farm.plots) {
    const tokens = plot.tokens, worker = farm.workerToken;
    jobs.push({ uid: `flax:${building.uid}:${plot.field.id}:sow`, islandId: "home", cycleTicks: sowTicks,
      inputs: { [worker]: 1, [tokens.stubble]: 1 }, outputs: { [worker]: 1, [tokens.growing]: 1 } });
    jobs.push({ uid: `flax:${building.uid}:${plot.field.id}:grow`, islandId: "home",
      cycleTicks: farm.growthTicks, inputs: { [tokens.growing]: 1 }, outputs: { [tokens.ripe]: 1 } });
    jobs.push({ uid: `flax:${building.uid}:${plot.field.id}:pull`, islandId: "home", cycleTicks: harvestTicks,
      inputs: { [worker]: 1, [tokens.ripe]: 1 }, outputs: { [worker]: 1, [tokens.drying]: 1 } });
    jobs.push({ uid: `flax:${building.uid}:${plot.field.id}:collect`, islandId: "home",
      cycleTicks: collectTicks, inputs: { [worker]: 1, [tokens.drying]: 1 },
      outputs: { [worker]: 1, [tokens.stubble]: 1, flax: 1 } });
  }
  return jobs;
};
const initialToken = (state: string, tokens: Tokens) => {
  if (state === "growing") return tokens.initialGrowing;
  if (state === "ripe") return tokens.ripe;
  if (state === "drying") return tokens.drying;
  if (state === "stubble") return tokens.stubble;
  return undefined;
};

/**
 * Explicit fast flax farms: saved plot phases, real worker serialization, soil reuse and a finite
 * six-slot output shelf through the logistics producer account. Growth is passive and uses only the
 * field talent; the farm level speeds authored sow/pull/collect work.
 */
export const prepareOfflineEconomyFlax = (
  save: GameSaveV1, world: WorldData, islandId: string
): OfflineEconomyFlaxPrepare => {
  const state = save.settlement;
  const colony = state.buildings.some(building => building.typeId === 39 && !building.militaryFaction);
  const reservedCells = new Set<number>(), jobs: Job[] = [], stock: Record<string, number> = {};
  const farms: FastFarm[] = [], collectJobs: Job[] = [], notes: string[] = [];
  const growthTicks = Math.max(1, Math.ceil(FLAX_GROWTH_SECONDS / growthRate(save) * TPS));
  for (const building of state.buildings) {
    if (building.typeId !== 60 || building.construction !== 1 || building.militaryFaction) continue;
    const worker = state.actors.find(actor => actor.uid === building.worker);
    if (building.worker === undefined || !worker || building.productionPaused) {
      notes.push(`Farm ${building.uid}: unstaffed or paused; saved plots retain their phase.`);
      continue;
    }
    const plots = farmPlots(save, world, building, reservedCells);
    if (!plots.length) {
      notes.push(`Farm ${building.uid}: no legal flax plot; no harvest was invented.`);
      continue;
    }
    const farm: FastFarm = { building, growthTicks, plots: [], workerToken: workerToken(building.uid) };
    stock[farm.workerToken] = 1;
    for (const entry of plots) {
      const tokens = plotTokens(building.uid, entry.field.id), initial = initialToken(entry.field.state, tokens);
      if (!initial) { notes.push(`Farm ${building.uid}: unsupported saved plot ${entry.field.id} retained.`); continue; }
      const plot: FastPlot = { ...entry, farmUid: building.uid, initialProgress: entry.field.progress,
        tokens, growthJob: `flax:${building.uid}:${entry.field.id}:grow`,
        initialGrowthJob: `flax:${building.uid}:${entry.field.id}:grow-initial`,
        sowJob: `flax:${building.uid}:${entry.field.id}:sow` };
      add(stock, initial, 1);
      if (entry.field.state === "growing") {
        const remaining = Math.max(1, Math.ceil((1 - entry.field.progress) *
          FLAX_GROWTH_SECONDS / growthRate(save) * TPS));
        jobs.push({ uid: plot.initialGrowthJob, islandId: "home", cycleTicks: remaining,
          inputs: { [tokens.initialGrowing]: 1 }, outputs: { [tokens.ripe]: 1 } });
      }
      farm.plots.push(plot);
    }
    if (!farm.plots.length) continue;
    const plotJobs = createPlotJobs(save, world, farm, colony);
    for (const job of plotJobs) if (job.uid.endsWith(":collect")) collectJobs.push(job);
    jobs.push(...plotJobs);
    farms.push(farm);
    notes.push(`Farm ${building.uid}: ${farm.plots.length} explicit flax plots ` +
      `(${farm.plots.filter(plot => plot.added).length} legally available new sites), one grower.`);
  }
  return {
    farms: farms.map(farm => farm.building.uid), jobs, notes, stock,
    attachOutputAccounts: accounts => {
      for (const job of collectJobs) {
        const farmUid = Number(job.uid.split(":")[1]);
        const account = accounts.get(farmUid);
        if (account) job.outputAccountId = account;
      }
    },
    apply: (result, horizonTicks) => {
      const ledger = result.islands.find(island => island.islandId === islandId);
      if (!ledger) throw new Error("Offline flax island ledger unavailable");
      const frames = new Map<number, SettlementFieldFrame>();
      for (const farm of farms) {
        for (const plot of farm.plots) {
          const tokenUnits = (phase: keyof Tokens) => own(ledger.stock, plot.tokens[phase]);
          let stateName: FieldState | undefined;
          if (tokenUnits("ripe") > 0) stateName = "ripe";
          else if (tokenUnits("drying") > 0) stateName = "drying";
          else if (tokenUnits("stubble") > 0) stateName = "stubble";
          else if (tokenUnits("growing") > 0 || tokenUnits("initialGrowing") > 0) stateName = "growing";
          if (!stateName) throw new Error(`Offline flax plot ${plot.field.id} lost its owner token`);
          const sown = own(result.completedCycles, `${islandId}:${plot.sowJob}`) > 0;
          if (plot.added && !sown && stateName === "stubble") continue;
          let progress = stateName === "ripe" || stateName === "drying" ? 1 : 0;
          if (stateName === "growing") {
            const job = result.inProgress.find(work => work.uid === `${islandId}:` +
              (tokenUnits("initialGrowing") > 0 ? plot.initialGrowthJob : plot.growthJob));
            const start = job?.startTick ?? 0;
            progress = tokenUnits("initialGrowing") > 0
              ? Math.min(1, plot.initialProgress + (horizonTicks - start) / (FLAX_GROWTH_SECONDS / growthRate(save) * TPS))
              : Math.min(1, (horizonTicks - start) / (FLAX_GROWTH_SECONDS / growthRate(save) * TPS));
          }
          const capped = stateName === "growing" ? Math.min(1 - 1e-9, progress) : progress;
          frames.set(plot.field.id, { ...plot.field, progress: Math.max(0, Math.min(1, capped)),
            state: stateName, step: 0 });
        }
        const next = state.fields.map(field => frames.get(field.id) ?? field);
        for (const [id, frame] of frames) if (!next.some(field => field.id === id)) next.push(frame);
        state.fields = next;
      }
      if (farms.length) notes.push("Saved field phases, crop reuse and partial growth were retained for the horizon.");
    }
  };
};
