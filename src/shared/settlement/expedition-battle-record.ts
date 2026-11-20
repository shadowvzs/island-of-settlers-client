import { isBanditSiteRef } from "@shared/catalog";

import type { BanditSiteRef } from "../../render-common/buildings/bandit-camp-plan";
import type { MilitaryTroopType } from "./military-combat-rules";
import type { EmigratedTroop } from "./settlement-military";
import { ownerOf } from "./settlement-ownership";
import type { SettlementBuilding } from "./settlement-types";

export type TroopCounts = Partial<Record<MilitaryTroopType, number>>;
export interface ExpeditionBattleRecord {
  sent: TroopCounts;
  lost: TroopCounts;
  defeated: TroopCounts;
  buildings: { bandit?: BanditSiteRef; type: number; uid: number }[];
  /** Missing earlier history is explicitly shown rather than guessed from survivors. */
  incomplete?: boolean;
}
const countBattleTroops = (troops: readonly Pick<EmigratedTroop, "type">[]): TroopCounts => {
  const counts: TroopCounts = {};
  for (const troop of troops) counts[troop.type] = (counts[troop.type] ?? 0) + 1;
  return counts;
};
export const createBattleRecord = (troops: readonly EmigratedTroop[], buildings: readonly SettlementBuilding[]) => ({
  sent: countBattleTroops(troops), lost: {}, defeated: {},
  buildings: buildings.filter(building => ownerOf(building) > 0)
    .map(building => ({ uid: building.uid, type: building.typeId, bandit: building.bandit }))
} satisfies ExpeditionBattleRecord);
export const copyBattleRecord = (record?: ExpeditionBattleRecord): ExpeditionBattleRecord | undefined => record && ({
  ...record, sent: { ...record.sent }, lost: { ...record.lost }, defeated: { ...record.defeated },
  buildings: record.buildings.map(building => ({ ...building }))
});
export const addBattleTroops = (record: ExpeditionBattleRecord | undefined, troops: readonly EmigratedTroop[]) => {
  if (!record) return;
  for (const troop of troops) record.sent[troop.type] = (record.sent[troop.type] ?? 0) + 1;
};
export const recordBattleDeath = (record: ExpeditionBattleRecord | undefined, type: MilitaryTroopType, faction: number) => {
  if (!record) return;
  const counts = faction === 0 ? record.lost : record.defeated;
  counts[type] = (counts[type] ?? 0) + 1;
};
const validCounts = (value: unknown) => !!value && typeof value === "object" && !Array.isArray(value) &&
  Object.entries(value).every(([type, count]) => ["shield", "heavy", "archer", "cavalry"].includes(type) &&
    Number.isSafeInteger(count) && count >= 0);
export const validBattleRecord = (record: ExpeditionBattleRecord | undefined) => record === undefined ||
  (!!record && validCounts(record.sent) && validCounts(record.lost) && validCounts(record.defeated) &&
    (record.incomplete === undefined || typeof record.incomplete === "boolean") && Array.isArray(record.buildings) &&
    record.buildings.every(building => building && Number.isSafeInteger(building.uid) && building.uid >= 0 &&
      Number.isSafeInteger(building.type) && building.type >= 0 &&
      (building.bandit === undefined || isBanditSiteRef(building.bandit))));
