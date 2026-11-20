import type { SettlementContext } from "../../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../../src/shared/world/world-data";

/** The wall's columns and the gate's rows (inclusive) of `walledContext`. */
export const WALL_COLUMNS = [24, 25] as const;
export const GATE_ROWS = { from: 22, to: 25 } as const;

/** A flat 48 x 48 world with a wall across x = 24..25 and a gate at z = 22..25 (`gate` false: no gate). */
export const walledContext = (gate = true) => {
  const size = 48;
  const world = { cellsX: size, cellsZ: size, heights: new Float32Array((size + 1) ** 2),
    blocking: new Uint8Array(size ** 2), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    mineZone: new Uint16Array(size ** 2), mineZones: [], oreAmount: new Uint8Array(size ** 2),
    props: { count: 0, scale: new Float32Array(), types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() },
    seaLevel: -1, seed: 1, start: { x: 4.5, z: 4.5 }, walkCost: new Uint8Array(size ** 2).fill(10) } as unknown as WorldData;
  for (let z = 0; z < size; z++)
    for (const x of WALL_COLUMNS)
      if (!gate || z < GATE_ROWS.from || z > GATE_ROWS.to) world.walkCost[z * size + x] = 0;
  return { actors: [], buildings: [], occupied: new Uint8Array(size ** 2), options: { world },
    reservations: new Set() } as unknown as SettlementContext;
};
