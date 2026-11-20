import type { I18n } from "@lingui/core";

import { displayBanditSiteName, displayTroopName } from "../../shared/i18n/domain";
import { translateMessage } from "../../shared/i18n/translate";
import type { MilitaryTroopType } from "../../shared/settlement/military-combat-rules";
import { isOwnBuilding } from "../../shared/settlement/settlement-home";
import type { SettlementSoldier } from "../../shared/settlement/settlement-military";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import { type BoxSize, clampBoxCorner } from "../helpers";
import { SETTLEMENT_DEBUG_MESSAGES as M } from "./debug-messages";

/** A building the player does not own: an enemy or bandit site (captured ones turn faction 0). */
export const isHostileBuilding = (building: Pick<SettlementBuilding, "militaryFaction">) =>
  !isOwnBuilding(building);

/** One tooltip line: soldiers of one type and tier inside the building. */
export interface HostileTroopRow {
  count: number;
  label: string;
}

const TROOP_ORDER: readonly MilitaryTroopType[] = ["shield", "heavy", "archer", "cavalry"];

const isOccupying = (soldier: SettlementSoldier, uid: number) =>
  soldier.building === uid && soldier.stationed && (soldier.combat?.hp ?? 1) > 0;

const compareRows = (left: [string, number], right: [string, number]) => {
  const [leftType, leftRank] = left[0].split(":"), [rightType, rightRank] = right[0].split(":");
  const byType = TROOP_ORDER.indexOf(leftType as MilitaryTroopType) -
    TROOP_ORDER.indexOf(rightType as MilitaryTroopType);
  return byType || Number(rightRank) - Number(leftRank);
};

/** The soldiers stationed in one hostile building, counted per type and tier (highest tier first). */
export const getHostileGarrisonRows = (
  soldiers: readonly SettlementSoldier[], uid: number, nation: string, i18n?: I18n
): HostileTroopRow[] => {
  const counts = new Map<string, number>();
  for (const soldier of soldiers) {
    if (!isOccupying(soldier, uid)) continue;
    const key = `${soldier.combat?.type ?? "shield"}:${soldier.rank}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort(compareRows).map(([key, count]) => {
    const [type, rank] = key.split(":");
    return { count, label: translateMessage(i18n, M.debug.hostile.row, {
      tier: Number(rank) + 1,
      troop: displayTroopName(nation, type as MilitaryTroopType, true, i18n)
    }) };
  });
};

/** A bandit camp keeps its site name; any other hostile building its nation building name. */
export const getHostileBuildingName = (
  building: Pick<SettlementBuilding, "bandit" | "enemyCampEnclosure" | "typeId">,
  buildingName: (typeId: number) => string,
  i18n?: I18n
) => {
  if (building.bandit === undefined) return buildingName(building.typeId);
  return displayBanditSiteName(building.bandit, building.enemyCampEnclosure, i18n);
};

/** The tooltip's title, rows and empty note; `key` changes only when the shown text changes. */
export const getHostileTooltipView = (name: string, rows: readonly HostileTroopRow[], i18n?: I18n) => {
  const empty = rows.length ? null : translateMessage(i18n, M.debug.hostile.empty);
  const title = translateMessage(i18n, M.debug.hostile.title, { name });
  return { empty, key: `${title}|${rows.map(row => `${row.count}${row.label}`).join("|")}`, rows, title };
};

export type HostileTooltipView = ReturnType<typeof getHostileTooltipView>;

const TOOLTIP_MARGIN = 8;

/** Top-left corner of a tooltip centred above `anchor`, kept inside the viewport with a margin. */
export const getTooltipCorner = (anchor: { x: number; y: number }, size: BoxSize, bounds: BoxSize) => {
  const centred = { x: anchor.x - size.width / 2, y: anchor.y - size.height };
  const corner = clampBoxCorner(centred, size, bounds, TOOLTIP_MARGIN);
  return { x: Math.round(corner.x), y: Math.round(corner.y) };
};
