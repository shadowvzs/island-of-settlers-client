import { NATION_DRINK_CHAINS as DRINK_CHAIN_DATA } from "@shared/catalog/building-data/drinks";

import type { WorkerNation } from "../../render-common/workers/worker-unit";

export { DRINK_WARES, isForeignDrinkWare, RAW_DRINK_WARES } from "@shared/catalog/building-data/drinks";

/** Outdoor work of building ID 5: what its worker sets around the house (owner, 2026-10-13). */
export type PlantationKind = "vine" | "hive" | "rice" | "palm" | "tea" | "pomegranate" | "cacao" | "berries";

/**
 * Each nation's drink chain in building slots 5 (raw producer) and 6 (drink maker), read by the shared catalog from
 * their rules sidecars; the drinks are trade and quest wares.
 */
export interface NationDrinkChain {
  drink: string;
  maker: string;
  /** Building 5's worker (its tool is the catalog `settler:*` tool). */
  grower: string;
  plantation: PlantationKind;
  raw: string;
}

export const NATION_DRINK_CHAINS = DRINK_CHAIN_DATA as Readonly<Record<WorkerNation, NationDrinkChain>>;

export const nationDrinkChain = (nation: WorkerNation = "roman") => NATION_DRINK_CHAINS[nation];

/**
 * Plantation tuning. Persistent plantations (hives, palms) stay after a harvest and refill in
 * `regrowSeconds`; the others turn to stubble and are sown again. `standOff` keeps the worker
 * beside a solid site (hive box, palm trunk) instead of inside it.
 */
export interface PlantationDefinition {
  growSeconds: number;
  limit: number;
  /** Search radius in cells around the building. */
  radius: number;
  /** New plots go next to the building's existing ones where possible (one joined paddy field). */
  adjoining?: boolean;
  regrowSeconds?: number;
  standOff: number;
  ware: string;
}

/** Planting to first harvest, the same for every nation (owner, 2026-10-13). */
const PLANTATION_GROW_SECONDS = 150;
/** Hives and palms refill in the same time for every nation that has one. */
const PLANTATION_REGROW_SECONDS = 75;

export const PLANTATIONS: Readonly<Record<PlantationKind, PlantationDefinition>> = {
  // These visually perennial plants use the vine's maintenance visit before fruit regrows,
  // preserving its complete production cadence rather than skipping a 24-second field visit.
  tea: { growSeconds: PLANTATION_GROW_SECONDS, limit: 6, radius: 8, standOff: .6, ware: "teaLeaves" },
  pomegranate: { growSeconds: PLANTATION_GROW_SECONDS, limit: 6, radius: 8, standOff: .6, ware: "pomegranate" },
  cacao: { growSeconds: PLANTATION_GROW_SECONDS, limit: 6, radius: 8, standOff: .6, ware: "cacaoBeans" },
  berries: { growSeconds: PLANTATION_GROW_SECONDS, limit: 6, radius: 8, standOff: .6, ware: "berries" },
  hive: { growSeconds: PLANTATION_GROW_SECONDS, limit: 6, radius: 5, regrowSeconds: PLANTATION_REGROW_SECONDS,
    standOff: .45, ware: "honey" },
  palm: { growSeconds: PLANTATION_GROW_SECONDS, limit: 6, radius: 6, regrowSeconds: PLANTATION_REGROW_SECONDS,
    standOff: .45, ware: "coconut" },
  rice: { adjoining: true, growSeconds: PLANTATION_GROW_SECONDS, limit: 6, radius: 8, standOff: 0, ware: "rice" },
  vine: { growSeconds: PLANTATION_GROW_SECONDS, limit: 6, radius: 8, standOff: .6, ware: "grapes" }
};

export const isPlantationKind = (kind: string): kind is PlantationKind => kind in PLANTATIONS;
