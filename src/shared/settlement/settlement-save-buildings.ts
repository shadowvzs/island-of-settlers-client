import { isBanditSiteRef } from "@shared/catalog";

import {
  banditCampPlan, banditMilitaryTypeId, type BanditSiteRef, isOpenArcherTower, placedBanditCamp
} from "../../render-common/buildings/bandit-camp-plan";
import { BUILDING_CATALOG } from "../../render-common/buildings/building-catalog";
import { DMath } from "../math/deterministic-math";
import { isHostileCatapultVariant } from "../world/scenario-catapult";
import { validArmoryOrders } from "./armory-orders";
import { bridgeSiteProblem, bridgeSiteStockProblem } from "./bridge-construction";
import { savedBridgeBankProblem } from "./bridge-river-banks";
import { SAWMILL_TYPE_ID } from "./building-type-ids";
import {
  catapultAmmoUnits, DEFAULT_CATAPULT_AMMO, isCatapultAmmoKind
} from "./catapult-ammo-kinds";
import type { CatapultCycle } from "./catapult-cycle";
import { catapultPhaseDuration } from "./catapult-cycle";
import { RETIRED_BANDIT_SITE_FORMAT } from "./constants";
import { fisherBoatSaveProblem } from "./fisher-boat-save";
import { CATAPULT, CATAPULT_PHASE_SECONDS } from "./military-catapult";
import { CATAPULT_ROOF_CAPACITY, catapultAmmoError } from "./military-catapult-ammo";
import { catapultSupplyError } from "./military-catapult-resupply";
import { STORAGE_IDS } from "./production-rules";
import { validResidenceTimer } from "./residences";
import { roadVergeSiteProblem } from "./road-verge-planting";
import {
  isFiniteNumber,
  isSaveGoods,
  isSaveInteger,
  isSaveObject,
  isSavePoint
} from "./save-validation";
import { unlockedSawmillRecipes } from "./sawmill-recipes";
import { isHomeBuilding } from "./settlement-home";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";
import { validWorkshopUpgrade } from "./workshop-upgrades";

/** A saved bandit site: known `bandit:` code and layout, the catalog's military type, plot and entrance. */
const savedBanditSiteProblem = (building: Record<string, unknown>) => {
  const site = building.bandit;
  if (site === undefined) return null;
  if (!isBanditSiteRef(site) || building.typeId !== banditMilitaryTypeId(site) ||
    !isSaveInteger(building.militaryFaction) || building.militaryFaction < 0) return "Invalid neutral camp layout";
  const plan = banditCampPlan(site), turned = (building.rotation as number) % 2 !== 0;
  if (building.width !== plan.cells[turned ? 1 : 0] || building.depth !== plan.cells[turned ? 0 : 1])
    return "Invalid neutral camp footprint";
  const expected = placedBanditCamp(site, building.x as number, building.z as number, building.rotation as number);
  for (const key of ["access", "workerApproach", "doorThreshold"] as const) {
    const point = building[key] as { x: number; z: number };
    if (DMath.hypot(point.x - expected[key].x, point.z - expected[key].z) > 1e-5)
      return "Invalid neutral camp entrance";
  }
  return building.hasDoor === (plan.kind !== "tower") ? null : "Invalid neutral camp door";
};

const keepsHandcarts = (typeId: unknown) =>
  STORAGE_IDS.has(typeId as number) || typeId === SAWMILL_TYPE_ID;
const isLoadableBuildingType = (typeId: unknown) =>
  BUILDING_CATALOG.some((definition) => definition.id === typeId);

/** The chosen kind is never plain stone (that is the absent default); the rack order is only a hint. */
const validCatapultAmmoChoice = (building: Record<string, unknown>) => {
  const choice = building.catapultAmmo, order = building.catapultRackKinds;
  if (choice !== undefined && (!isCatapultAmmoKind(choice) || choice === DEFAULT_CATAPULT_AMMO)) return false;
  return order === undefined || (Array.isArray(order) && order.length > 0 &&
    order.length <= CATAPULT_ROOF_CAPACITY && order.every(isCatapultAmmoKind));
};
const validCatapultState = (building: Record<string, unknown>) => {
  if (building.catapultAim !== undefined &&
    (building.typeId !== 16 || building.construction !== 1 || !isFiniteNumber(building.catapultAim) ||
      Math.abs(building.catapultAim) > Math.PI + 1e-9)) return false;
  if (building.catapultReload !== undefined &&
    (building.typeId !== 16 || building.construction !== 1 || !isFiniteNumber(building.catapultReload) ||
      building.catapultReload < 0 || building.catapultReload > CATAPULT.reload)) return false;
  if (building.catapultCycle !== undefined) {
    const cycle = building.catapultCycle;
    if (building.typeId !== 16 || building.construction !== 1 || !isSaveObject(cycle) ||
      !isSaveInteger(cycle.operator) || !isSaveInteger(cycle.target) ||
      (cycle.stoneSlot !== undefined && (!isSaveInteger(cycle.stoneSlot) || cycle.stoneSlot >= CATAPULT.capacity)) ||
      typeof cycle.phase !== "string" || !Object.hasOwn(CATAPULT_PHASE_SECONDS, cycle.phase) ||
      !isFiniteNumber(cycle.elapsed) || cycle.elapsed < 0 ||
      (CATAPULT_PHASE_SECONDS[cycle.phase as keyof typeof CATAPULT_PHASE_SECONDS] > 0
        ? cycle.elapsed > catapultPhaseDuration(cycle as unknown as CatapultCycle) : cycle.elapsed > 3600) ||
      (cycle.turnVelocity !== undefined && (!isFiniteNumber(cycle.turnVelocity) || Math.abs(cycle.turnVelocity) > CATAPULT.aimSpeed + 1e-9))) return false;
  }
  if (building.typeId !== 16)
    return building.catapultSupply === undefined && building.catapultAmmo === undefined &&
      building.catapultRackKinds === undefined;
  if (building.construction !== 1)
    return building.catapultSupply === undefined && building.catapultRackKinds === undefined &&
      validCatapultAmmoChoice(building);
  if (!validCatapultAmmoChoice(building)) return false;
  const input = building.input as Record<string, number>, incoming = building.incoming as Record<string, number>;
  if (catapultAmmoError(building.catapultCycle as CatapultCycle | undefined, input)) return false;
  const roof = catapultAmmoUnits(input), promised = catapultAmmoUnits(incoming);
  return !catapultSupplyError(building.catapultSupply, roof, promised) && roof + promised <= CATAPULT.capacity &&
    [input, incoming].every(goods => Object.entries(goods).every(([ware, count]) =>
      isCatapultAmmoKind(ware) || count === 0));
};

/** `expectedHomes` is 1 (headquarters or colony harbour), or 0 on a building-free adventure island. */
export const validateSavedBuildings = (
  buildings: unknown[],
  world: SettlementContext["options"]["world"],
  ids: Set<number>,
  expectedHomes: number
) => {
  for (const building of buildings) {
    if (
      !isSaveObject(building) ||
      (building.territoryClaimed !== undefined && typeof building.territoryClaimed !== "boolean") ||
      !isSaveInteger(building.uid) ||
      ids.has(building.uid) ||
      !isLoadableBuildingType(building.typeId) ||
      !isSavePoint(building) ||
      !isFiniteNumber(building.y) ||
      !isSaveInteger(building.rotation) ||
      building.rotation > 3 ||
      !isFiniteNumber(building.width) ||
      building.width <= 0 ||
      !isFiniteNumber(building.depth) ||
      building.depth <= 0 ||
      !isFiniteNumber(building.construction) ||
      building.construction < 0 ||
      building.construction > 1 ||
      building.x < building.width / 2 ||
      building.x + building.width / 2 > world.cellsX ||
      building.z < building.depth / 2 ||
      building.z + building.depth / 2 > world.cellsZ ||
      !isSavePoint(building.access) ||
      !isSavePoint(building.workerApproach) ||
      !isSavePoint(building.doorThreshold) ||
      !isFiniteNumber(building.cycle) ||
      !isFiniteNumber(building.door) ||
      typeof building.hasDoor !== "boolean" ||
      typeof building.working !== "boolean" ||
      typeof building.selected !== "boolean" ||
      typeof building.status !== "string"
    )
      return "Invalid building placement or identity";
    if (building.enemyCampModel !== undefined) return RETIRED_BANDIT_SITE_FORMAT;
    if (building.enemyCatapultVariant !== undefined &&
      (building.typeId !== 16 || !isHostileCatapultVariant(building.enemyCatapultVariant) ||
        building.bandit !== undefined || !isSaveInteger(building.militaryFaction)))
      return "Invalid hostile Catapult identity";
    if (building.eventCourtyard !== undefined) {
      const court = building.eventCourtyard;
      if (!isSaveObject(court) || !Array.isArray(court.walls) || court.walls.length !== 4 ||
        !isBanditSiteRef(building.bandit) || building.enemyCampEnclosure !== undefined ||
        (building.width as number) < 2 || (building.depth as number) < 2 ||
        isOpenArcherTower({ bandit: building.bandit as BanditSiteRef }) ||
        !court.walls.every(wall => isSaveObject(wall) && isFiniteNumber(wall.hp) &&
          isFiniteNumber(wall.maximum) && wall.maximum > 0 && wall.hp >= 0 && wall.hp <= wall.maximum))
        return "Invalid event courtyard walls";
    }
    if (building.enemyCampEnclosure !== undefined &&
      (building.enemyCampEnclosure !== "building" || building.bandit === undefined))
      return "Invalid neutral building enclosure";
    const banditReason = savedBanditSiteProblem(building);
    if (banditReason) return banditReason;
    if (
      building.idleSettlers !== undefined &&
      (!STORAGE_IDS.has(building.typeId as number) || !isSaveInteger(building.idleSettlers))
    )
      return "Invalid storage population";
    if (building.settlerGrowthTime !== undefined && !validResidenceTimer(building as unknown as SettlementBuilding))
      return "Invalid residence growth timer";
    if (
      building.handcarts !== undefined &&
      (!keepsHandcarts(building.typeId) || !isSaveInteger(building.handcarts))
    )
      return "Invalid storage hand carts";
    if (
      building.handcartMode !== undefined &&
      (building.typeId !== SAWMILL_TYPE_ID || building.handcartMode !== true)
    )
      return "Invalid sawmill mode";
    const fisherBoatProblem = fisherBoatSaveProblem(building, world);
    if (fisherBoatProblem) return fisherBoatProblem;
    for (const key of ["input", "output", "inventory", "incoming", "required"])
      if (!isSaveGoods(building[key])) return "Invalid building stock";
    if (!validCatapultState(building)) return "Invalid catapult supply or action";
    if (
      building.foundationTileIndex !== undefined &&
      (!isFiniteNumber(building.foundationTileIndex) ||
        !Number.isInteger(building.foundationTileIndex) ||
        building.foundationTileIndex < 0 ||
        building.foundationTileIndex > building.width * building.depth)
    )
      return "Invalid leveling tile index";
    if (
      building.foundationTileWork !== undefined &&
      (!isFiniteNumber(building.foundationTileWork) ||
        building.foundationTileWork < 0 ||
        building.foundationTileWork > 3.6)
    )
      return "Invalid leveling tile work";
    if (
      building.foundationProgress !== undefined &&
      (!isFiniteNumber(building.foundationProgress) ||
        building.foundationProgress < 0 ||
        building.foundationProgress > 1)
    )
      return "Invalid foundation progress";
    if (!validWorkshopUpgrade(building as unknown as SettlementBuilding)) return "Invalid workshop upgrade";
    if (building.typeId === 33 && building.selectedOutput !== undefined &&
      !unlockedSawmillRecipes(building as unknown as SettlementBuilding)
        .some(recipe => recipe.output === building.selectedOutput)) return "Invalid or locked sawmill recipe";
    if (building.shipReserve !== undefined && !isSaveGoods(building.shipReserve)) return "Invalid ship reserve";
    if (building.bridgeSite !== undefined) {
      const bridgeProblem = bridgeSiteProblem(building.bridgeSite);
      if (bridgeProblem) return bridgeProblem;
      const bridge = building.bridgeSite as import("./bridge-construction").BridgeConstructionSite;
      const stockProblem = bridgeSiteStockProblem(bridge, building.required);
      if (stockProblem) return stockProblem;
      if ([bridge.start.x, bridge.end.x].some(value => value < 0 || value > world.cellsX) ||
        [bridge.start.z, bridge.end.z].some(value => value < 0 || value > world.cellsZ))
        return "Bridge construction leaves the island grid";
      const bankProblem = savedBridgeBankProblem(world, [bridge]);
      if (bankProblem) return bankProblem;
    }
    if (building.vergeSite !== undefined) {
      const vergeProblem = roadVergeSiteProblem(building.vergeSite, building.required);
      if (vergeProblem) return vergeProblem;
    }
    if (building.constructionConsumed !== undefined && !isSaveGoods(building.constructionConsumed))
      return "Invalid construction receipts";
    if (
      !isSaveObject(building.accepts) ||
      !Object.values(building.accepts).every((item) => typeof item === "boolean")
    )
      return "Invalid storage preferences";
    if (
      building.colonyHome !== undefined &&
      (building.typeId !== 39 || building.colonyHome !== true)
    )
      return "Invalid colony home harbour";
    if (
      building.foundedByExpedition !== undefined &&
      (building.typeId !== 39 || typeof building.foundedByExpedition !== "boolean")
    )
      return "Invalid expedition harbour";
    if (
      building.foundingAnchor !== undefined &&
      (building.typeId !== 39 || building.foundingAnchor !== true || building.construction !== 1)
    )
      return "Invalid founding harbour protection";
    if (
      building.pigFeedPhase !== undefined &&
      !["grain", "water", "breeding", "idle"].includes(building.pigFeedPhase as string)
    )
      return "Invalid pig feeding phase";
    if (
      (building.productionPaused !== undefined && typeof building.productionPaused !== "boolean") ||
      (building.exports !== undefined &&
        (!isSaveObject(building.exports) ||
          !Object.values(building.exports).every((item) => typeof item === "boolean")))
    )
      return "Invalid production or storage policy";
    // Demand ranking waits: saved ticks per ware (owner 2026-11-09).
    if (building.demandWaitSince !== undefined && !isSaveGoods(building.demandWaitSince))
      return "Invalid demand waiting ticks";
    if (
      building.productionOrders !== undefined &&
      (building.typeId !== 24 || !validArmoryOrders(building.productionOrders))
    )
      return "Invalid armory orders";
    ids.add(building.uid);
  }
  const homes = buildings.filter((building) =>
    isHomeBuilding(building as SettlementBuilding)
  ).length;
  if (homes === expectedHomes) return null;
  return expectedHomes
    ? "Save must contain exactly one headquarters"
    : "An adventure save holds no home building";
};
