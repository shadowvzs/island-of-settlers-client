import { FLAX_FIELD_LIMIT,WHEAT_FIELD_LIMIT } from "../balance/economy";
import { DMath } from "../math/deterministic-math";
import { CHARCOAL_WORK_STAND_OFF } from "./charcoal-field";
import { advanceFieldProgress } from "./field-growth-timer";
import { isPlantationKind, nationDrinkChain, type PlantationKind,PLANTATIONS } from "./nation-drinks";
import { roadDecorationFieldBounds } from "./road-decoration-fields";
import { getBuilding } from "./settlement-building-index";
import {
  DEFAULT_FARM_RADIUS,   defaultFarmArea, defaultWorkArea, type FarmArea, type FarmAreaBounds,
inFarmArea, inFarmRange} from "./settlement-farm-area";
import { createFieldSiteValidator } from "./settlement-field-sites";
import { buildingNation } from "./settlement-nation";
import { economyOwnerOf, economyOwners, PLAYER_FACTION } from "./settlement-ownership";
import { bumpFieldNavigationRevision, bumpNavigationRevision, isFieldCellReserved } from "./settlement-reservations";
import { contextTalents, talentsOf } from "./settlement-talents";
import type { Goods, ResourceTarget, SettlementBuilding, SettlementContext } from "./settlement-types";
import { planWheatBatch } from "./settlement-wheat-planning";
import { createWheatScanRotation } from "./settlement-wheat-scan";
import { outdoorWorkPath } from "./settlement-worker-stock-paths";

/** "fruiting": a persistent hive or palm refilling after a harvest; it never becomes stubble. */
export type FieldState =
  "growing" | "ripe" | "stubble" | "building" | "burning" | "uncovering" | "coal" | "fruiting" | "drying";
export type FieldKind = "grain" | "flax" | "charcoal" | PlantationKind;
export const FIELD_KINDS: readonly FieldKind[] =
  ["grain", "flax", "charcoal", ...Object.keys(PLANTATIONS) as PlantationKind[]];
export const FIELD_STATES: readonly FieldState[] =
  ["growing", "ripe", "stubble", "building", "burning", "uncovering", "coal", "fruiting", "drying"];
export interface SettlementFieldFrame {
  id: number; owner: number; kind: FieldKind;
  x: number; z: number; state: FieldState; progress: number; step: number;
  /** Render-only (fieldFrames): 0..1 while a worker harvests this site; never saved. */
  harvest?: number;
}
export interface FieldWork {
  stage?: "sow" | "harvest";
  batch?: ResourceTarget[];
  target: ResourceTarget; path: Array<{ x: number; z: number }>; inputs: string[];
}
export interface SettlementFieldCycles {
  update(dt: number): void;
  /** Bumped whenever a worker, demolition or load changes a site; event plans rescan only then. */
  revision(): number;
  removeBuilding(uid:number):void;
  isOccupied(x: number, z: number): boolean;
  /** A crop or charcoal site of any stage (stubble too) holds the cell: no building plot may cover it. */
  hasSite(cell: number): boolean;
  findWork(building: SettlementBuilding, canSearch?: () => boolean): FieldWork | null;
  complete(building: SettlementBuilding, target: ResourceTarget): { success: boolean; ware?: string };
  snapshot(): readonly SettlementFieldFrame[];
  restore(fields: readonly SettlementFieldFrame[]): void;
  setFarmArea(uid: number, bounds: FarmAreaBounds | null): boolean;
  farmArea(uid: number): FarmArea | null;
}
const cropKind = (building: SettlementBuilding, context: SettlementContext): FieldKind => {
  if (building.typeId === 27) return "charcoal";
  if (building.typeId === 60) return "flax";
  if (building.typeId === 37) return "grain";
  return building.typeId === 5 ? nationDrinkChain(buildingNation(context, building)).plantation : "grain";
};
/** Crop growth rate of a site on an island with computer economies: its farm's economy talents. */
const siteCropRate = (context: SettlementContext, site: SettlementFieldFrame) => {
  const farm = getBuilding(context, site.owner);
  const owner = farm ? economyOwnerOf(context, farm) : PLAYER_FACTION;
  return 1 + talentsOf(context, owner).fieldGrowthSpeed;
};
const isCropKind = (kind: FieldKind) => kind === "grain" || kind === "flax";
const isCropFarm = (typeId: number) => typeId === 37 || typeId === 60;
const MATURING_STATES = new Set<FieldState>(["growing", "burning", "fruiting"]);
const HARVEST_STATES = new Set<FieldState>(["ripe", "drying", "coal", "uncovering"]);
const siteLimit = (kind: FieldKind) => {
  if (kind === "charcoal") return 2;
  if (kind === "grain") return WHEAT_FIELD_LIMIT;
  if (kind === "flax") return FLAX_FIELD_LIMIT;
  return PLANTATIONS[kind].limit;
};
/** Where the worker stands: grain, flax and solid plantations are worked from beside; charcoal clears its clamp. */
export const fieldWorkStandOff = (kind: FieldKind) => {
  if (kind === "charcoal") return CHARCOAL_WORK_STAND_OFF;
  if (isCropKind(kind)) return .42;
  return isPlantationKind(kind) ? PLANTATIONS[kind].standOff : 0;
};
/** Work contact on the building side of a field site, outside the crop/clamp footprint. */
export const fieldWorkPoint = (
  kind: FieldKind,
  target: { x: number; z: number },
  origin: { x: number; z: number }
) => {
  const offset = fieldWorkStandOff(kind);
  if (!offset) return target;
  const dx = target.x - origin.x, dz = target.z - origin.z;
  const distance = DMath.hypot(dx, dz) || 1;
  return { x: target.x - dx / distance * offset, z: target.z - dz / distance * offset };
};
const searchRadius = (kind: FieldKind) => isPlantationKind(kind) ? PLANTATIONS[kind].radius : 8;
const isAdjoining = (kind: FieldKind) => isPlantationKind(kind) && PLANTATIONS[kind].adjoining === true;
/** Least distance between plot centres: adjoining paddies sit side by side (owner, 2026-10-13). */
const siteSpacing = (kind: FieldKind) => {
  if (isCropKind(kind)) return 1.7;
  return isAdjoining(kind) ? 1 : 1.4;
};
/** Cells sharing a side with one of the given plots. */
const touchesAny = (target: ResourceTarget, plots: readonly SettlementFieldFrame[]) =>
  plots.some(plot => Math.abs(plot.x - target.x) + Math.abs(plot.z - target.z) <= 1.01);
/**
 * Nearest free cells first; for adjoining plantations (rice paddies) cells sharing a side with the
 * building's existing plots come before all others, so the paddies grow into one joined field.
 */
export const orderPlantingCells = (
  cells: ResourceTarget[], building: SettlementBuilding, kind: FieldKind, plots: readonly SettlementFieldFrame[]
) => {
  const adjoining = isAdjoining(kind) && plots.length > 0;
  const distance = (cell: ResourceTarget) => DMath.hypot(cell.x - building.x, cell.z - building.z);
  const detached = (cell: ResourceTarget) => adjoining && !touchesAny(cell, plots) ? 1 : 0;
  return cells.sort((a, b) => detached(a) - detached(b) || distance(a) - distance(b) || a.id - b.id);
};
/** A ripe crop gives its ware; hives and palms stay and refill, other crops turn to stubble. */
const harvestSite = (site: SettlementFieldFrame) => {
  const plantation = isPlantationKind(site.kind) ? PLANTATIONS[site.kind] : undefined;
  const persistent = plantation?.regrowSeconds !== undefined;
  site.state = persistent ? "fruiting" : "stubble";
  site.progress = 0;
  if (["tea", "pomegranate", "cacao", "berries"].includes(site.kind)) site.step = 1;
  return { success: true, ware: plantation?.ware ?? (site.kind === "flax" ? "flax" : "grain") };
};
/** Grain and rice sow or harvest; flax pulls then dries; the other plantations mark only harvest visits. */
const fieldWorkStage = (kind: string, site?: SettlementFieldFrame): FieldWork["stage"] => {
  if (kind === "grain" || kind === "rice") {
    return site?.state === "ripe" ? "harvest" : "sow";
  }
  if (kind === "flax") {
    if (site?.state === "ripe" || site?.state === "drying") return "harvest";
    return site === undefined || site.state === "stubble" ? "sow" : undefined;
  }
  return site?.state === "ripe" ? "harvest" : undefined;
};
export const createSettlementFieldCycles = (context: SettlementContext): SettlementFieldCycles => {
  const sites: SettlementFieldFrame[] = [];
  const byCell = new Map<number, SettlementFieldFrame>();
  let revision = 0;
  const { world } = context.options;
  const areaFor = (building: SettlementBuilding): FarmArea => defaultFarmArea(world, building);
  const targetFor = (site: SettlementFieldFrame): ResourceTarget => ({
    id: site.id, kind: "field", x: site.x, z: site.z
  });
  const inputsFor = (site: SettlementFieldFrame | undefined, building: SettlementBuilding) => {
    if (building.typeId === 27 && (!site || site.state === "building" || site.state === "stubble"))
      // Six fuel-loading visits alternate with six earth-covering visits; covering needs no ware.
      return (site?.step ?? 0) % 2 === 0 ? ["logs"] : [];
    return [];
  };
  const hasInputs = (stock: Goods, inputs: string[]) => inputs.every((ware) => (stock[ware] ?? 0) > 0);
  const canUse = createFieldSiteValidator(context, sites);
  const wheatScan = createWheatScanRotation();
  const workPath = (building: SettlementBuilding, target: ResourceTarget) => {
    const kind = cropKind(building, context);
    return outdoorWorkPath(
      context,
      building,
      fieldWorkPoint(kind, target, building.workerApproach)
    );
  };
  /** Free plots for a new site in `rows` of the search area. */
  const emptyCells = (building: SettlementBuilding, kind: FieldKind, search: FarmAreaBounds,
    rows: { maxZ: number; minZ: number } = search) => {
    const empty: ResourceTarget[] = [];
    for (let z = rows.minZ; z <= rows.maxZ; z++)
      for (let x = search.minX; x <= search.maxX; x++) {
        const id = z * world.cellsX + x;
        if (isCropKind(kind) && DMath.hypot(x + .5 - building.access.x, z + .5 - building.access.z) > DEFAULT_FARM_RADIUS - .75) continue;
        if (byCell.has(id) || context.reservations.has(`field:${id}`) || !canUse(x, z, undefined, isCropKind(kind), siteSpacing(kind), kind)) continue;
        empty.push({ id, kind: "field", x: x + 0.5, z: z + 0.5 });
      }
    return empty;
  };
  /** Stubble plots of the farm that can be sown again with the same crop. */
  const stubbleTargets = (building: SettlementBuilding, kind: FieldKind, active: readonly SettlementFieldFrame[]) =>
    active.filter(site => site.state === "stubble" && site.kind === kind &&
      DMath.hypot(site.x - building.access.x, site.z - building.access.z) <= DEFAULT_FARM_RADIUS - .75 &&
      !context.reservations.has(`field:${site.id}`) &&
      canUse(Math.floor(site.x), Math.floor(site.z), site.id, isCropKind(kind), siteSpacing(kind), kind))
      .map(targetFor);
  /** Sowing targets; a farm waiting for a clear plot scans its area one band per search (wheat-scan.ts). */
  const wheatTargets = (building: SettlementBuilding, active: readonly SettlementFieldFrame[], area: FarmArea) => {
    const scan = (rows: { maxZ: number; minZ: number }) =>
      [...emptyCells(building, "grain", area, rows), ...stubbleTargets(building, "grain", active)];
    const targets = scan(wheatScan.rows(building.uid, area));
    return wheatScan.finish(building.uid, targets.length > 0) ? scan(area) : targets;
  };
  const findWork = (building: SettlementBuilding, canSearch = () => true): FieldWork | null => {
    const pathTo = (target: ResourceTarget) => canSearch() ? workPath(building, target) : null;
    const kind = cropKind(building, context);
    const area = defaultFarmArea(world, building);
    const crop = isCropKind(kind);
    const active = sites.filter((site) => site.owner === building.uid && site.kind === kind &&
      (!crop || site.state !== "stubble" || (inFarmArea(area, site) && inFarmRange(building, site))));
    const growingCount = active.filter((site) => site.state !== "stubble").length;
    const candidates = active.filter((site) => !MATURING_STATES.has(site.state));
    candidates.sort((a, b) => Number(HARVEST_STATES.has(b.state)) - Number(HARVEST_STATES.has(a.state)) ||
      DMath.hypot(a.x - building.x, a.z - building.z) - DMath.hypot(b.x - building.x, b.z - building.z));
    for (const site of candidates) {
      if (kind === "grain" && site.state === "stubble") continue;
      if (kind === "flax" && site.state === "stubble" &&
        !canUse(Math.floor(site.x), Math.floor(site.z), site.id, true, siteSpacing(kind), kind)) continue;
      if (context.reservations.has(`field:${site.id}`)) continue;
      const inputs = inputsFor(site, building);
      if (!hasInputs(building.input, inputs)) continue;
      const path = pathTo(targetFor(site));
      if (path) return { target: targetFor(site), path, inputs,
        stage: fieldWorkStage(kind, site) };
    }
    if (kind === "charcoal" && active.some((site) => site.state === "building")) return null;
    if ((crop ? growingCount : active.length) >= siteLimit(kind)) return null;
    const inputs = inputsFor(undefined, building);
    if (!hasInputs(building.input, inputs)) return null;
    if (kind === "grain")
      return planWheatBatch(wheatTargets(building, active, area), building, growingCount, target => pathTo(target));
    const empty = emptyCells(building, kind, defaultWorkArea(world, building, searchRadius(kind)));
    const targets = crop ? [...stubbleTargets(building, kind, active), ...empty] : empty;
    for (const target of orderPlantingCells(targets, building, kind, active)) {
      const path = pathTo(target);
      if (path) return { target, path, inputs, stage: fieldWorkStage(kind, byCell.get(target.id)) };
    }
    return null;
  };
  const blocksGround = (site?: SettlementFieldFrame) => !!site && site.state !== "stubble";
  const complete = (building: SettlementBuilding, target: ResourceTarget) => {
    const before = blocksGround(byCell.get(target.id));
    const result = advanceSite(building, target);
    if (result.success) revision++;
    if (blocksGround(byCell.get(target.id)) !== before) bumpFieldNavigationRevision(context, [target.id]);
    return result;
  };
  const advanceSite = (building: SettlementBuilding, target: ResourceTarget) => {
    let site = byCell.get(target.id);
    const kind = cropKind(building, context);
    if ((!site || site.state === "stubble") && context.roadDecorations?.frames().length &&
      !context.roadDecorations.isFree(roadDecorationFieldBounds(context, kind, target.x, target.z))) return { success: false };
    if (isCropFarm(building.typeId) && (!site || site.state === "stubble") &&
      (sites.filter((entry) => entry.owner === building.uid && entry.kind === kind && entry.state !== "stubble").length >= siteLimit(kind) ||
        !inFarmArea(defaultFarmArea(world, building), target) ||
        DMath.hypot(target.x - building.access.x, target.z - building.access.z) > DEFAULT_FARM_RADIUS - .75 ||
        !canUse(Math.floor(target.x), Math.floor(target.z), target.id, true, siteSpacing(kind), kind)))
      return { success: false };
    if (site && (site.owner !== building.uid || site.kind !== kind)) return { success: false };
    if (!site) {
      if (context.occupied[target.id]) return { success: false };
      site = { ...target, kind, owner: building.uid, progress: 0, state: "stubble",
        step: 0 };
      sites.push(site); byCell.set(site.id, site);
    }
    if (kind === "flax") {
      // Two physical contacts: hand-pull into a drying bundle, then collect the dry fibre once.
      if (site.state === "ripe") { site.state = "drying"; site.progress = 1; return { success: true }; }
      if (site.state === "drying") {
        site.state = "stubble"; site.progress = 0;
        return { success: true, ware: "flax" };
      }
      if (site.state !== "stubble") return { success: false };
      site.state = "growing"; site.progress = 0;
      return { success: true };
    }
    if (kind !== "charcoal") {
      if (site.state === "ripe") return harvestSite(site);
      if (site.state !== "stubble") return { success: false };
      site.state = "growing"; site.progress = 0;
      return { success: true };
    }
    if (site.state === "stubble") { site.state = "building"; site.step = 0; }
    if (site.state === "building") {
      site.step++; site.progress = site.step / 12;
      if (site.step === 12) { site.state = "burning"; site.progress = 0; site.step = 0; }
      return { success: true };
    }
    if (site.state === "uncovering") {
      if (++site.step === 6) { site.state = "coal"; site.step = 0; }
      return { success: true };
    }
    if (site.state === "coal") {
      if (++site.step === 6) { site.state = "stubble"; site.step = 0; site.progress = 0; }
      return { success: true, ware: "coal" };
    }
    return { success: false };
  };
  const update = (dt: number) => {
    // Crops (never charcoal piles) ripen faster with the field growth talent of the farm's economy.
    const playerRate = 1 + contextTalents(context).fieldGrowthSpeed;
    const perOwner = economyOwners(context).length > 1;
    for (const site of sites) {
      const next = advanceFieldProgress(site, dt, perOwner ? siteCropRate(context, site) : playerRate);
      if (!next) continue;
      site.progress = next.progress;
      site.state = next.state;
      if (next.state === "ripe" || next.state === "uncovering") site.step = 0;
    }
  };
  const isOccupied = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) return false;
    const cell = Math.floor(z) * world.cellsX + Math.floor(x);
    if (isFieldCellReserved(context, cell)) return true;
    const site = byCell.get(cell);
    return !!site && site.state !== "stubble";
  };
  const farmArea = (uid: number) => {
    const building = context.buildings?.find((entry) => entry.uid === uid && isCropFarm(entry.typeId));
    return building ? areaFor(building) : null;
  };
  // Legacy callers may clear an old selection; farms always choose their own nearby sites.
  const setFarmArea = (uid: number, bounds: FarmAreaBounds | null) =>
    bounds === null && context.buildings.some(building => building.uid === uid && isCropFarm(building.typeId));
  const removeBuilding=(uid:number) => {
    const before = sites.length;
    for(let i=sites.length-1;i>=0;i--)if(sites[i]!.owner===uid){
      const site=sites[i]!;byCell.delete(Math.floor(site.z)*world.cellsX+Math.floor(site.x));sites.splice(i,1);
      if (blocksGround(site)) bumpNavigationRevision(context);
    }
    if (sites.length !== before) revision++;
  };
  const restore = (fields: readonly SettlementFieldFrame[]) => {
    wheatScan.clear();
    sites.splice(0, sites.length, ...fields); byCell.clear();
    for (const site of sites) byCell.set(Math.floor(site.z) * world.cellsX + Math.floor(site.x), site);
    revision++;
    bumpNavigationRevision(context);
  };
  return { restore, removeBuilding, revision: () => revision, update, findWork, complete, isOccupied,
    hasSite: (cell: number) => byCell.has(cell),
    setFarmArea, farmArea, snapshot: () => sites };
};
