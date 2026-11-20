import {
  buildingEntry, type BuildingNavigationLevel, type CanonicalStockSlot, type EncodedNavigationVolume
} from "@shared/catalog";
import { buildingGeometry } from "@shared/catalog/building-data/geometry";
import {
  buildingNavigationLevel, decodeNavigationVolume, loadedBuildingNavigation
} from "@shared/catalog/building-data/navigation";

import type { WorkerNation } from "../workers/worker-nation";
import { computeBuildingNavigationLevel } from "./building-geometry-reference";
import { buildingPartNavigationVolumes } from "./building-navigation-profile";
import type { BuildingNavigationVolume } from "./building-navigation-types";
import type { BuildingLevel } from "./levels/building-level";
import { seatRomanWareStockParts } from "./roman-ware-stock";

interface FixedStockSolid {
  kind: "input" | "output";
  slot: number;
  volume: BuildingNavigationVolume;
  ware: string;
  wares?: readonly string[];
}

/** A finished building's public-navigation solids for one nation and level, decoded once from its sidecar. */
export interface BuildingNavigationData {
  fixedStock: readonly FixedStockSolid[];
  interiors: readonly BuildingNavigationVolume[];
  obstacles: readonly BuildingNavigationVolume[];
  scale: number;
  slots: readonly CanonicalStockSlot[];
}

const cache = new Map<string, BuildingNavigationData>();
const warned = new Set<string>();

/** The stored level; a nation whose sidecars were not loaded yet falls back to evaluating its recipe once. */
const storedLevel = (typeId: number, nation: WorkerNation, level: BuildingLevel): BuildingNavigationLevel => {
  const file = loadedBuildingNavigation(buildingEntry(typeId)!.key, nation);
  if (file) return buildingNavigationLevel(file, level);
  if (!warned.has(nation)) {
    warned.add(nation);
    console.warn(`Building navigation of ${nation} is not loaded; evaluating recipes (loadBuildingNavigation)`);
  }
  return computeBuildingNavigationLevel(typeId, nation, level);
};

/** Decoded volumes are fresh per level and never mutated; the stored tuples are read-only. */
const decodeVolume = (encoded: EncodedNavigationVolume) => decodeNavigationVolume(encoded) as BuildingNavigationVolume;

const decode = (typeId: number, stored: BuildingNavigationLevel): BuildingNavigationData => ({
  fixedStock: stored.stock.fixed.map(stock => ({ ...stock, volume: decodeVolume(stock.volume) })),
  interiors: stored.interiors.map(decodeVolume),
  obstacles: stored.obstacles.map(decodeVolume),
  scale: buildingGeometry(typeId)!.plot.scale,
  slots: stored.stock.slots
});

/** Navigation data of a finished building, cached by national level (stable identity for the simulation's caches). */
export const getBuildingNavigationData = (typeId: number, nation: WorkerNation, level: BuildingLevel = 1) => {
  const key = `${typeId}:${nation}:${level}`;
  let data = cache.get(key);
  if (!data) {
    data = decode(typeId, storedLevel(typeId, nation, level));
    cache.set(key, data);
  }
  return data;
};

const seatedVolumes = new WeakMap<BuildingNavigationData, Map<string, readonly BuildingNavigationVolume[]>>();
/**
 * Solids of every stock display with this kind and slot number that shows `ware` (the renderer's mixed-ware
 * presentation for one requested ware, filtered as the inventory filters it), in presentation order.
 */
const canonicalVolumes = (data: BuildingNavigationData, kind: string, slot: number, ware: string) => {
  const key = `${kind}:${slot}:${ware}`;
  let byKey = seatedVolumes.get(data);
  if (!byKey) { byKey = new Map(); seatedVolumes.set(data, byKey); }
  let volumes = byKey.get(key);
  if (volumes) return volumes;
  const shows = (candidate: { kind: string; slot: number; ware: string; wares?: readonly string[] }) =>
    candidate.kind === kind && candidate.slot === slot && (candidate.ware === ware || candidate.wares?.includes(ware));
  // The presentation lists the fixed stock parts first, then the seated canonical wares.
  const parts = data.slots.filter(shows).flatMap(candidate => seatRomanWareStockParts(
    { ...candidate, stock: { kind: candidate.kind, slot: candidate.slot, ware: candidate.ware,
      wares: candidate.wares } }, ware, data.scale, true));
  volumes = [...data.fixedStock.filter(shows).map(stock => stock.volume),
    ...buildingPartNavigationVolumes(parts, data.scale)];
  byKey.set(key, volumes);
  return volumes;
};

/** The ware a canonical slot shows for live counts: its slot index walks the concatenated counts of its wares. */
const shownWare = (slot: CanonicalStockSlot, inventory: Readonly<Record<string, number>>) => {
  let index = slot.slot;
  for (const candidate of slot.wares ?? [slot.ware]) {
    const count = Math.max(0, inventory[candidate] ?? 0);
    if (index < count) return candidate;
    index -= count;
  }
  return undefined;
};

/** Live stock solids, equal to the recipe's inventory presentation for these counts. */
export const buildingStockNavigationVolumesFromData = (data: BuildingNavigationData,
  input: Readonly<Record<string, number>>, output: Readonly<Record<string, number>>) => {
  const volumes: BuildingNavigationVolume[] = [];
  for (const stock of data.fixedStock) {
    const inventory = stock.kind === "input" ? input : output;
    if (stock.slot < (inventory[stock.ware] ?? 0)) volumes.push(stock.volume);
  }
  for (const slot of data.slots) {
    const ware = shownWare(slot, slot.kind === "input" ? input : output);
    if (ware) volumes.push(...canonicalVolumes(data, slot.kind, slot.slot, ware));
  }
  return volumes;
};
