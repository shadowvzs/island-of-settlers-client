import type { MineZone, WorldData } from "../../world-data";
import type { TerrainEditState } from "../terrain/terrain-edit-state";

/** A value before and after an edit. */
export interface Sides<T> {
  after: T;
  before: T;
}

export type DiffSide = keyof Sides<unknown>;

/** The terrain tool's state besides its per vertex arrays (those are diffed as layers). */
export interface TerrainMeta {
  nextId: number;
  ringCells: ReadonlySet<number>;
  stampProps: ReadonlyMap<number, number[]>;
  stamps: TerrainEditState["stamps"];
}

/** Rough memory of a cell set or prop map entry (history byte budget). */
const ENTRY_BYTES = 16;
const ZONE_BYTES = 64;

/** A copy of the terrain state's lists (the stamps are immutable, their list is replaced). */
export const copyTerrainMeta = (state: TerrainEditState): TerrainMeta => ({
  nextId: state.nextId,
  ringCells: new Set(state.ringCells),
  stampProps: new Map(state.stampProps),
  stamps: state.stamps
});

/** Whether the stamps changed since the copy (ring cells and stamp props follow the stamps). */
export const isTerrainChanged = (meta: TerrainMeta, state: TerrainEditState) =>
  meta.stamps !== state.stamps || meta.nextId !== state.nextId;

export const restoreTerrainMeta = (state: TerrainEditState, meta: TerrainMeta) => {
  state.nextId = meta.nextId;
  state.ringCells = new Set(meta.ringCells);
  state.stampProps = new Map(meta.stampProps);
  state.stamps = meta.stamps;
};

export const getTerrainMetaBytes = (meta: TerrainMeta) =>
  (meta.ringCells.size + meta.stampProps.size + meta.stamps.length) * ENTRY_BYTES;

export const copyZones = (zones: readonly MineZone[]) => zones.map((zone) => ({ ...zone }));

const isSameZone = (first: MineZone, second: MineZone) =>
  (Object.keys(first) as (keyof MineZone)[]).every((key) => first[key] === second[key]);

export const isSameZones = (first: readonly MineZone[], second: readonly MineZone[]) =>
  first.length === second.length && first.every((zone, index) => isSameZone(zone, second[index]!));

/**
 * The mine zone records as they were (in place: the records keep their identity); the survey
 * state is runtime state and stays.
 */
export const restoreZones = (world: WorldData, zones: readonly MineZone[]) => {
  world.mineZones.length = Math.min(world.mineZones.length, zones.length);
  zones.forEach((zone, index) => {
    const current = world.mineZones[index];
    if (!current) {
      world.mineZones.push({ ...zone });
      return;
    }
    Object.assign(current, { ...zone, surveyed: current.surveyed });
  });
};

export const getZonesBytes = (zones: Sides<MineZone[]>) =>
  (zones.after.length + zones.before.length) * ZONE_BYTES;
