import { AI_POSTURES, buildProgramOf } from "@shared/catalog/ai/build-programs";

import { SETTLEMENT_WARES } from "../settlement-building-policies";
import { outstandingConstructionNeed } from "../settlement-local-stock";
import { ownerOf } from "../settlement-ownership";
import type { SettlementBuilding, SettlementContext } from "../settlement-types";

const wareIndexes = new Map(SETTLEMENT_WARES.map((ware, index) => [ware, index]));

/** A ware's index into the economy manager's arrays (`SETTLEMENT_WARES` order); -1: no settlement ware. */
export const economyWareIndex = (ware: string) => wareIndexes.get(ware) ?? -1;

/**
 * A style's stock targets (plan §3.6) per posture (`AI_POSTURES` order), one whole count per settlement ware, with
 * the resume margin below them; and the per-decision scratch of the faction's stock (never saved: every decision
 * writes it before reading).
 */
export interface EconomyStock {
  /** What the faction's pools hold per ware. */
  readonly pooled: Int32Array;
  /** What its construction sites still wait for per ware (beyond delivered, incoming and consumed). */
  readonly promised: Int32Array;
  readonly resumeMargin: number;
  readonly targets: readonly Int32Array[];
}

const resolved = new Map<string, EconomyStock>();

/** The style's targets, resolved once (catalog data is frozen), so a decision only reads numbers. */
export const economyStockOf = (style: string): EconomyStock => {
  const program = buildProgramOf(style);
  const cached = resolved.get(program.style);
  if (cached) return cached;
  const { default: fallback, resumeMargin, wares } = program.stock;
  const created: EconomyStock = {
    pooled: new Int32Array(SETTLEMENT_WARES.length), promised: new Int32Array(SETTLEMENT_WARES.length), resumeMargin,
    targets: AI_POSTURES.map(posture => Int32Array.from(SETTLEMENT_WARES, ware => (wares[ware] ?? fallback)[posture]))
  };
  resolved.set(program.style, created);
  return created;
};

const addPooled = (pooled: Int32Array, goods: Readonly<Record<string, number>>) => {
  for (const ware in goods) {
    const index = economyWareIndex(ware);
    if (index >= 0) pooled[index]! += goods[ware]!;
  }
};

const addPromised = (promised: Int32Array, site: SettlementBuilding) => {
  for (const ware in site.required) {
    const index = economyWareIndex(ware);
    if (index >= 0) promised[index]! += outstandingConstructionNeed(site, ware);
  }
};

/**
 * Reads the faction's own stock (plan §3.2: own state is fully known): its pools' free goods and what its sites
 * still wait for. Reads only; wares move by carriers alone (plan §3.6).
 */
export const readEconomyStock = (context: SettlementContext, faction: number, stock: EconomyStock) => {
  const { pooled, promised } = stock;
  pooled.fill(0);
  promised.fill(0);
  for (const pool of context.storagePools?.pools ?? []) if (pool.owner === faction) addPooled(pooled, pool.available);
  for (const building of context.buildings)
    if (building.construction < 1 && ownerOf(building) === faction) addPromised(promised, building);
};

/** Free stock of a ware: pooled minus what the faction's sites still wait for (may be negative). */
export const freeStock = ({ pooled, promised }: EconomyStock, index: number) => pooled[index]! - promised[index]!;

/** The build queue starves for the ware: its sites wait for more than the pools hold. */
export const starvedWare = ({ pooled, promised }: EconomyStock, index: number) =>
  promised[index]! > 0 && pooled[index]! < promised[index]!;
