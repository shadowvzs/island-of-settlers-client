import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { getBuildingProductionRule, getProductionRule } from "../../src/shared/settlement/production-rules";
import type { Goods } from "../../src/shared/settlement/settlement-types";

export interface BuildingProduction {
  islandId: string;
  uid: number;
  typeId: number;
  produced: Goods;
}

export const metalworksToolWares = new Set(getProductionRule(25)!.outputs);

export const offlineProductionIslands = (source: GameSaveV1, stripArchipelago = false) => {
  const islands = new Map<string, GameSaveV1>([[String(stripArchipelago ? "home" :
    source.archipelago?.active ?? "home"), source]]);
  if (stripArchipelago || !source.archipelago) return islands;
  const group = source.archipelago;
  if (group.active !== null && group.home) islands.set("home", group.home);
  for (const record of [...group.colonies, ...(group.adventures ?? [])])
    if (record.save && record.expeditionId !== group.active) islands.set(String(record.expeditionId), record.save);
  return islands;
};

export const offlineProductionSchema = (saves: Iterable<GameSaveV1>) => {
  const otherOutputs = new Set<string>();
  let hasMetalworks = false;
  for (const save of saves) for (const building of save.settlement.buildings) {
    if (building.typeId === 25) { hasMetalworks = true; continue; }
    for (const output of getBuildingProductionRule(building, save.settlement.playerNation)?.outputs ?? [])
      otherOutputs.add(output);
  }
  return { hasMetalworks, otherOutputs };
};

/** Owner policy: compare Metalworks throughput as a total; armory outputs keep their own gates. */
export const groupMetalworksProduction = (
  goods: Readonly<Goods>, buildings: readonly BuildingProduction[],
  toolWares: ReadonlySet<string>, otherOutputs: ReadonlySet<string>
): Goods => {
  const grouped = { ...goods };
  let tools = 0;
  for (const building of buildings) {
    if (building.typeId !== 25) continue;
    for (const [ware, count] of Object.entries(building.produced)) {
      if (!toolWares.has(ware) || !Number.isSafeInteger(count) || count < 0 || count > (grouped[ware] ?? 0))
        throw new Error("Metalworks production attribution does not match physical output");
      grouped[ware] = (grouped[ware] ?? 0) - count;
      tools += count;
    }
  }
  for (const ware of toolWares) if (!otherOutputs.has(ware)) {
    if (grouped[ware]) throw new Error(`Unattributed Metalworks output: ${ware}`);
    delete grouped[ware];
  }
  grouped.metalworksTools = tools;
  return grouped;
};
