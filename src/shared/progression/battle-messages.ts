import { isBanditSiteRef } from "@shared/catalog";

import { type BanditSiteRef, sameBanditSite } from "../../render-common/buildings/bandit-camp-plan";
import { type ExpeditionBattleRecord, type TroopCounts,validBattleRecord } from "../settlement/expedition-battle-record";
import { ownerOf } from "../settlement/settlement-ownership";
import type { SettlementBuilding } from "../settlement/settlement-types";

export interface BattleMessage {
  id: string;
  kind: "adventure" | "colony";
  island: string;
  date: number;
  nation: string;
  read: boolean;
  sent: TroopCounts;
  lost: TroopCounts;
  defeated: TroopCounts;
  buildings: { bandit?: BanditSiteRef; count: number; type: number }[];
  goods: Record<string, number>;
  experience: number;
  incomplete: boolean;
}
export const createBattleMessage = (input: {
  kind: BattleMessage["kind"]; island: { name: string; seed: number }; date: number; nation: string;
  battle?: ExpeditionBattleRecord; buildings: readonly SettlementBuilding[];
  goods: Readonly<Record<string, number>>; experience: number;
}): BattleMessage => {
  const buildings: BattleMessage["buildings"] = [];
  for (const target of input.battle?.buildings ?? []) {
    if (input.buildings.some(building => building.uid === target.uid && ownerOf(building) > 0)) continue;
    const entry = buildings.find(entry => entry.type === target.type && sameBanditSite(entry.bandit, target.bandit));
    if (entry) entry.count++;
    else buildings.push({ type: target.type, bandit: target.bandit, count: 1 });
  }
  return {
    id: `${input.kind}:${input.island.seed}:${input.date}`, kind: input.kind, island: input.island.name,
    date: input.date, nation: input.nation, read: false, sent: { ...input.battle?.sent },
    lost: { ...input.battle?.lost }, defeated: { ...input.battle?.defeated }, buildings,
    goods: { ...input.goods }, experience: input.experience, incomplete: !input.battle || !!input.battle.incomplete
  };
};
/** One stored battle report (adventure or colony). */
export const validBattleMessage = (message: unknown): message is BattleMessage => {
  const value = message as BattleMessage | null;
  return Boolean(value) && typeof value!.id === "string" &&
    ["adventure", "colony"].includes(value!.kind) && typeof value!.island === "string" &&
    typeof value!.nation === "string" && Number.isFinite(value!.date) && typeof value!.read === "boolean" &&
    typeof value!.incomplete === "boolean" && Number.isSafeInteger(value!.experience) && value!.experience >= 0 &&
    validBattleRecord({ sent: value!.sent, lost: value!.lost, defeated: value!.defeated, buildings: [] }) &&
    !!value!.goods && typeof value!.goods === "object" && !Array.isArray(value!.goods) &&
    Object.values(value!.goods).every(count => Number.isSafeInteger(count) && (count as number) >= 0) &&
    Array.isArray(value!.buildings) && value!.buildings.every((building: BattleMessage["buildings"][number]) =>
      building && Number.isSafeInteger(building.type) && building.type >= 0 &&
      Number.isSafeInteger(building.count) && building.count > 0 &&
      (building.bandit === undefined || isBanditSiteRef(building.bandit)));
};
