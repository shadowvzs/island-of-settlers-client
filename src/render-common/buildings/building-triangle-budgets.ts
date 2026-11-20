import { isBuildingFirstNation, type WorkerNation } from "../workers/worker-nation";

/** Advanced-material specialists 41–56 repeat four occupation families (41–44) across resource tiers. */
const isAdvancedSpecialist = (id: number) => id >= 41 && id <= 56;

/** The occupation family whose shell, budget and stock contacts a building shares. */
export const buildingFamilyId = (id: number) => (isAdvancedSpecialist(id) ? 41 + (id - 41) % 4 : id);

/**
 * Owner 2026-11-02: all building caps increased 50%, for both High and Minimal.
 * Historical measurements below describe the earlier geometry; budgets include the increase.
 * Measured [High, Minimal] triangle caps for specialist families: permanent specialist roof framing
 * and canonical material cargo stay in Minimal (at most 400 triangles above the shared shell).
 */
const SPECIALIST_TRIANGLE_BUDGETS: Readonly<Record<number, readonly [number, number]>> = {
  7: [14250, 2550], // Supplied Roman monument; other nations have their authored caps below.
  41: [16500, 4050], 42: [16500, 4050], 43: [16500, 4050], 44: [16500, 4050]
};

/** [High, Minimal] cap of an ordinary building (the asset export's shared default). */
const DEFAULT_TRIANGLE_BUDGET = [15000, 3450] as const;

/** The building's [High, Minimal] triangle cap: its specialist family's, else the shared default. */
export const buildingTriangleBudget = (id: number) =>
  SPECIALIST_TRIANGLE_BUDGETS[buildingFamilyId(id)] ?? DEFAULT_TRIANGLE_BUDGET;

/**
 * Per-occupation native [High, Minimal] budgets, including the approved Minimal dragon-head
 * refinement. Measured specialist exceptions (all tier copies inherit their occupation family):
 * Nubian sawmill Minimal: 1912 base +968 canonical cargo +236 framing =3116 (cap3200).
 * Japanese sawmill Minimal: 1646 +968 +236 =2850 (cap2900).
 * Japanese monument63: eleven closed storey heads, bearing soffits and Minimal floor slabs restore
 * continuity in possessed views (measured24,220 High/5,650 Minimal, with no extra draw calls).
 * Japanese woodcutter High: 8830 +2016 canonical cargo +788 twin-vent framing =11634 (cap11800).
 * Leatherworks High (owner 2026-10-20): six bench cuirasses with skirt and shoulder guards, ≤11584 (cap12000).
 */
const NATION_TRIANGLE_BUDGETS: Readonly<Record<WorkerNation, Readonly<Record<number, readonly [number, number]>>>> = {
  maya: { 7: [14250, 2550] },
  persian: { 7: [14250, 2550] },
  chinese: { 7: [14250, 2550] },
  indigenous: { 7: [14250, 2550] },
  japanese: { 7: [36750, 8550], 0: [39000, 6750], 29: [21000, 4275], 34: [39000, 6750],
    15: [18000, 3450], 42: [17700, 4050], 44: [16500, 4350] },
  nubian: { 7: [14250, 3000], 15: [18000, 3450], 44: [16500, 4800] },
  roman: { 5: [18450, 3600], 7: [14250, 2550] },
  viking: { 7: [21750, 4800], 0: [25500, 6000], 15: [18000, 3450] }
};

/** A nation's [High, Minimal] cap for a building; every level (1-5) shares it. */
export const nationTriangleBudget = (nation: WorkerNation, id: number) => {
  if (isBuildingFirstNation(nation)) {
    if (id === 7 || id === 0 || id === 9) return [48000, 9000] as const;
    return [27000, 5250] as const;
  }
  return NATION_TRIANGLE_BUDGETS[nation][buildingFamilyId(id)] ?? buildingTriangleBudget(id);
};
