import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { displayWareName } from "../../../shared/i18n/domain";
import { translateMessage } from "../../../shared/i18n/translate";
import {
  compositionTotal, GARRISON_TROOPS, type GarrisonComposition, type GarrisonTroop
} from "../../../shared/settlement/military-garrison-rules";
import type { MilitaryTrainingFocus } from "../../../shared/settlement/settlement-military";
import { troopPortrait } from "../../settlement/army-icons";
import { troopName, troopPluralName } from "../../settlement/troop-names";
import { getWareIconSource } from "../inventory";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementGarrisonSummary, SettlementSoldierDetails } from "../types";
import { getSoldierDetail, soldierRankName } from "./soldier-helpers";

export const getTrainingFocusChoices = (i18n?: I18n) => [
  { label: translateMessage(i18n, M.details.garrison.focusBalanced), value: "balanced" },
  { label: translateMessage(i18n, M.details.garrison.focusElite), value: "elite" }
] as const satisfies readonly { label: string; value: MilitaryTrainingFocus }[];

/** The counts the player edits: the manual plan, or what is inside or arriving while automatic. */
export const garrisonPlan = (garrison: SettlementGarrisonSummary): GarrisonComposition =>
  ({ ...(garrison.manual ?? garrison.assigned) });

/** One more of a type fits the building and a free soldier of it waits in storage. */
export const canAddGarrisonTroop = (garrison: SettlementGarrisonSummary, type: GarrisonTroop) => {
  const plan = garrisonPlan(garrison);
  if (garrison.catapultStatus && (type === "archer" || (type === "shield" && plan.heavy < 1))) return false;
  const missing = Math.max(0, plan[type] - garrison.assigned[type]);
  const free = garrison.stored[type] + (garrison.homeStored?.[type] ?? 0);
  return compositionTotal(plan) < garrison.capacity && free > missing;
};

/** The manual plan after one step of a type; null when it would drop below the occupied minimum. */
export const getChangedGarrisonPlan = (garrison: SettlementGarrisonSummary, type: GarrisonTroop, delta: number) => {
  const plan = garrisonPlan(garrison);
  plan[type] = Math.max(0, plan[type] + delta);
  if (garrison.catapultStatus && compositionTotal(plan) > 0 && plan.heavy < 1) return null;
  if (compositionTotal(plan) < (garrison.minimum ?? 0)) return null;
  return plan;
};

const getTroopRow = (
  garrison: SettlementGarrisonSummary, type: GarrisonTroop, nation: string, i18n?: I18n
) => {
  const plan = garrisonPlan(garrison);
  const keepsLast = compositionTotal(plan) <= (garrison.minimum ?? 0);
  const name = troopPluralName(nation, type, i18n);
  const lowerName = name.toLowerCase();
  const decreaseLabel = translateMessage(i18n, M.details.garrison.fewer, { name: lowerName });
  const arriving = Math.max(0, garrison.assigned[type] - garrison.stationed[type]);
  const requested = Math.max(0, plan[type] - garrison.assigned[type]);
  const movement = [
    arriving ? translateMessage(i18n, M.details.garrison.arriving, { count: arriving }) : "",
    requested ? translateMessage(i18n, M.details.garrison.requested, { count: requested }) : ""
  ].filter(Boolean).join(" · ");
  return {
    arriving,
    count: String(plan[type]),
    countLabel: translateMessage(i18n, M.details.garrison.wanted, { name }),
    decreaseDisabled: plan[type] === 0 || keepsLast,
    decreaseLabel,
    decreaseTitle: keepsLast && plan[type]
      ? translateMessage(i18n, M.details.garrison.keepLast) : decreaseLabel,
    icon: troopPortrait(nation, type),
    increaseDisabled: !canAddGarrisonTroop(garrison, type),
    increaseLabel: translateMessage(i18n, M.details.garrison.more, { name: lowerName }),
    movement,
    name,
    requested,
    stock: garrison.homeStored
      ? translateMessage(i18n, M.details.garrison.stockHome, {
        home: garrison.homeStored[type], stationed: garrison.stationed[type], stored: garrison.stored[type]
      })
      : translateMessage(i18n, M.details.garrison.stock, {
        stationed: garrison.stationed[type], stored: garrison.stored[type]
      }),
    type
  };
};

export type GarrisonTroopRow = ReturnType<typeof getTroopRow>;

/** Physically inside soldiers grouped by type+rank, with readable names, count and wounded detail. */
const getInsideRows = (
  garrison: SettlementGarrisonSummary, nation: string,
  soldiers: readonly SettlementSoldierDetails[] = [], i18n?: I18n
) => GARRISON_TROOPS.flatMap(type => (garrison.stationedByRank[type] ?? []).flatMap((count, rank) => {
  if (count < 1) return [];
  const rankName = soldierRankName(rank, i18n);
  const troop = count === 1 ? troopName(nation, type, i18n) : troopPluralName(nation, type, i18n);
  const group = soldiers.filter(soldier =>
    soldier.phase === "garrison" && soldier.type === type && soldier.rank === rank);
  const wounded = group.filter(soldier => soldier.health < soldier.maximumHealth).length;
  const health = group.reduce((total, soldier) => total + soldier.health, 0);
  const maximum = group.reduce((total, soldier) => total + soldier.maximumHealth, 0);
  const woundedText = wounded > 0
    ? translateMessage(i18n, M.details.soldiers.wounded, { count: wounded, health, maximum }) : "";
  const label = translateMessage(i18n, M.details.garrison.insideRow, { count, rank: rankName, troop });
  return [{
    count: String(count),
    icon: troopPortrait(nation, type, rank),
    key: `${type}-${rank}`,
    label,
    rank,
    rankBadge: ["I", "II", "III"][rank] ?? String(rank + 1),
    rankName,
    title: [label, woundedText, ...group.map(soldier => getSoldierDetail(soldier, nation, i18n))]
      .filter(Boolean).join("\n"),
    type,
    typeName: troop,
    wounded,
    woundedText
  }];
}));

const CATAPULT_STATUS_MESSAGES = {
  "no-heavy": msg`No heavy soldier`,
  defending: msg`Crew defending`,
  "no-stone": msg`No stone`,
  "no-porter": msg({ id: "military.catapult.needsCarrierResupply", message: "Roof resupply needs its carrier" }),
  restocking: msg({ id: "military.catapult.restocking", message: "Restocking roof" }),
  "supply-unsafe": msg({ id: "military.catapult.supplyUnsafe", message: "Roof resupply paused: entrance unsafe" }),
  "supply-blocked": msg({ id: "military.catapult.supplyBlocked", message: "Roof carrier cannot reach the stones" }),
  reloading: msg`Reloading`,
  ready: msg`Ready to fire`
};

/** Local coins and national drink, kept separate from warehouse totals and incoming reservations. */
const getSupplies = (garrison: SettlementGarrisonSummary, i18n?: I18n) => {
  const drinkName = displayWareName(garrison.drinkWare, i18n);
  return {
    coinCapacity: String(garrison.coinCapacity),
    coinCount: String(garrison.coinStock),
    coinIcon: getWareIconSource("coins"),
    coinIncoming: garrison.coinIncoming > 0
      ? translateMessage(i18n, M.details.garrison.onTheWay, { count: garrison.coinIncoming }) : null,
    coinsAllowed: garrison.coinsAllowed,
    coinToggleLabel: translateMessage(i18n,
      garrison.coinsAllowed ? M.details.garrison.coinsAllowed : M.details.garrison.coinsBlocked),
    coinStoredLabel: translateMessage(i18n, M.details.garrison.coinsStored),
    drinkCapacity: String(garrison.drinkCapacity),
    drinkCount: String(garrison.drinkStock),
    drinkIncoming: garrison.drinkIncoming > 0
      ? translateMessage(i18n, M.details.garrison.onTheWay, { count: garrison.drinkIncoming }) : null,
    drinkName,
    drinkStoredLabel: translateMessage(i18n, M.details.garrison.drinkStored, { drink: drinkName })
  };
};

/**
 * Military building garrison: archers hold the tower posts first, melee the rest. The player may set
 * exact counts per type from the free soldiers in storage, or return to automatic filling. The
 * summary separates soldiers physically inside (grouped by type+rank) from arriving/requested ones.
 */
export const getGarrisonView = (
  garrison: SettlementGarrisonSummary, nation: string,
  soldiers: readonly SettlementSoldierDetails[] = [], i18n?: I18n
) => {
  const inside = compositionTotal(garrison.stationed);
  const heading = garrison.posts
    ? translateMessage(i18n, M.details.garrison.headingPosts, {
      capacity: garrison.capacity, inside, posts: garrison.posts
    })
    : translateMessage(i18n, M.details.garrison.headingWindows, { capacity: garrison.capacity, inside });
  const supplies = getSupplies(garrison, i18n);
  return {
    automatic: garrison.manual === null,
    catapult: Boolean(garrison.catapultStatus),
    catapultStatus: garrison.catapultStatus
      ? translateMessage(i18n, CATAPULT_STATUS_MESSAGES[garrison.catapultStatus]) : null,
    stoneName: displayWareName("stone", i18n),
    stoneStock: String(garrison.stoneStock ?? 0),
    stoneRoofLabel: translateMessage(i18n, msg({ id: "military.catapult.roofStock", message: "Roof" })),
    stoneGroundLabel: translateMessage(i18n, msg({ id: "military.catapult.groundStock", message: "Ground: {count}" }), { count: garrison.stoneGround ?? 0 }),
    stoneCarriedLabel: (garrison.stoneCarried ?? 0) > 0 ? translateMessage(i18n,
      msg({ id: "military.catapult.carriedStock", message: "Hauling: {count}" }), { count: garrison.stoneCarried! }) : null,
    stoneIncoming: (garrison.stoneIncoming ?? 0) > 0
      ? translateMessage(i18n, M.details.garrison.onTheWay, { count: garrison.stoneIncoming! }) : null,
    heading,
    insideEmpty: inside === 0,
    insideRows: getInsideRows(garrison, nation, soldiers, i18n),
    rows: GARRISON_TROOPS.filter(type => !garrison.catapultStatus || type !== "archer")
      .map(type => getTroopRow(garrison, type, nation, i18n)),
    supplies,
    trainingFocus: garrison.trainingFocus ?? "balanced",
    trainingNote: translateMessage(i18n, M.details.garrison.trainingNote, {
      drink: supplies.drinkName.toLowerCase()
    })
  };
};
