import { DMath } from "../math/deterministic-math";
import type { WorldData } from "../world/world-data";
import { createShipOverlapTest, ENVELOPE_REACH, type ShipObstacle } from "./settlement-ship-clearance";
import type { SettlementPoint } from "./settlement-types";

interface Scratch { seen: Uint32Array; hit: Uint8Array; generation: number; busy: boolean }
interface Stencil { cells: Uint32Array; flags: Uint8Array }
const allocate = (length: number): Scratch => ({ seen: new Uint32Array(length),
  hit: new Uint8Array(length), generation: 0, busy: false });
const directionOf = (dx: number, dz: number) => {
  const index = (dz + 1) * 3 + dx + 1;
  return index > 4 ? index - 1 : index;
};
const headings: number[] = [];
for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]])
  headings[directionOf(dx!, dz!)] = DMath.atan2(dx!, dz!);
const exact = (value: number) => Object.is(value, -0) ? "-0" : String(value);

/** Rasterize only the strict collision neighbourhood, independent of terrain/mask contents. */
const stencilFor = (world: WorldData, other: ShipObstacle): Stencil => {
  const cells: number[] = [], flags: number[] = [], overlaps = createShipOverlapTest();
  const minX = Math.max(0, Math.floor(other.x - ENVELOPE_REACH - .5));
  const maxX = Math.min(world.cellsX - 1, Math.ceil(other.x + ENVELOPE_REACH - .5));
  const minZ = Math.max(0, Math.floor(other.z - ENVELOPE_REACH - .5));
  const maxZ = Math.min(world.cellsZ - 1, Math.ceil(other.z + ENVELOPE_REACH - .5));
  for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
    const point = { x: x + .5, z: z + .5 };
    if (!(Math.abs(other.x - point.x) < ENVELOPE_REACH && Math.abs(other.z - point.z) < ENVELOPE_REACH)) continue;
    let bits = 0;
    for (let direction = 0; direction < 8; direction++)
      if (overlaps({ ...point, yaw: headings[direction]! }, other)) bits |= 1 << direction;
    if (bits) { cells.push(z * world.cellsX + x); flags.push(bits); }
  }
  return { cells: Uint32Array.from(cells), flags: Uint8Array.from(flags) };
};

/** One immutable default collision query; custom findSeaRoute callbacks never enter this memo. */
export const createShipGridCollisionQueries = (generationLimit = 0xffffffff) => {
  if (!Number.isInteger(generationLimit) || generationLimit < 1 || generationLimit > 0xffffffff)
    throw new RangeError("Invalid ship-grid generation limit");
  const cache = new WeakMap<Uint8Array, Scratch>();
  const stencils = new Map<string, Stencil>();
  return {
    open: (world: WorldData, mask: Uint8Array, blocked: readonly ShipObstacle[]) => {
      let scratch = cache.get(mask);
      if (!scratch || scratch.seen.length !== mask.length) { scratch = allocate(mask.length); cache.set(mask, scratch); }
      else if (scratch.busy) scratch = allocate(mask.length);
      const state = scratch; state.busy = true;
      if (++state.generation > generationLimit) { state.seen.fill(0); state.generation = 1; }
      const generation = state.generation;
      for (const other of blocked) {
        // Include dimensions and every collision-relevant pose value; signed zero is not folded.
        const key = `${world.cellsX},${world.cellsZ}:${exact(other.x)},${exact(other.z)},${exact(other.yaw)}`;
        let stencil = stencils.get(key);
        if (!stencil) {
          stencil = stencilFor(world, other);
          if (stencils.size >= 256) stencils.delete(stencils.keys().next().value!);
          stencils.set(key, stencil);
        }
        for (let index = 0; index < stencil.cells.length; index++) {
          const cell = stencil.cells[index]!;
          if (state.seen[cell] !== generation) { state.seen[cell] = generation; state.hit[cell] = 0; }
          state.hit[cell] = state.hit[cell]! | stencil.flags[index]!;
        }
      }
      let released = false;
      const hit = (point: SettlementPoint, bit: number) => {
        // findSeaRoute supplies only nonnegative neighboring half-cell centres.
        const cell = (point.z - .5) * world.cellsX + point.x - .5;
        return state.seen[cell] === generation && Boolean(state.hit[cell]! & bit);
      };
      return {
        clearGrid: (from: number, to: number, dx: number, dz: number) => {
          const bit = 1 << directionOf(dx, dz);
          return !(state.seen[from] === generation && (state.hit[from]! & bit)) &&
            !(state.seen[to] === generation && (state.hit[to]! & bit));
        },
        clear: (from: SettlementPoint, to: SettlementPoint) => {
          const bit = 1 << directionOf(to.x - from.x, to.z - from.z);
          return !hit(from, bit) && !hit(to, bit);
        },
        release: () => { if (!released) { released = true; state.busy = false; } }
      };
    }
  };
};
