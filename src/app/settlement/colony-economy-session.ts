import { COLONY_SUPPLY_SECONDS } from "../../shared/balance/colonies";
import { colonyOreShipMs, findAdventure, findColony, setNextOreShip } from "../../shared/settlement/archipelago";
import { colonyAdvancedCargo } from "../../shared/settlement/colony-advanced-material-trade";
import {
  abstractOreShipment, addToHome, COLONY_FOODS, colonySupplyDemand, completedMines, FOOD, takeFromStorages
} from "../../shared/settlement/colony-economy";
import { colonyOreWare } from "../../shared/settlement/colony-island-rules";
import { settleColonyNativeOre } from "../../shared/settlement/colony-native-economy";
import type { Goods } from "../../shared/settlement/settlement-types";
import { savedStorageBuildings } from "../../shared/settlement/shared-storage";
import { wareBoxUnits } from "../../shared/settlement/ship-cargo-boxes";
import { describeWares } from "../settlement-ui/helpers";
import { type ColonyShipOptions, createColonyTroopShips, visitorVoyageSeconds } from "./colony-troop-ships";

/** Home: ore and evacuation checks; colony: garrison checks. */
const HOME_CHECK_SECONDS = 5;
const hasGoods = (goods: Goods) => Object.values(goods).some(count => count > 0);

/**
 * Ships between islands: on a colony, supplies come from the filed home stock every minute, soldiers
 * for its military buildings when they need them, and an hourly ship takes the ore home; at home,
 * conquered colonies' mines send ore for home food and freed colonies' leftovers are fetched.
 */
export const createColonyEconomy = (options: ColonyShipOptions) => {
  let supplyTime = 0, homeTime = 0, garrisonTime = 0;
  const { simulation } = options;
  const troopShips = createColonyTroopShips(options);
  const homeBuildings = () => {
    const home = options.group().home;
    return options.homeBuildings?.() ?? (home && savedStorageBuildings(home.settlement));
  };
  const oreShipInterval = () => colonyOreShipMs(simulation.talentModifiers().colonyShipIntervalReduction);
  const sendSupplies = () => {
    const buildings = homeBuildings();
    const demand = colonySupplyDemand(simulation.buildings());
    // Supplies already on their way (including ships queued for the berth) cover the same demand.
    for (const ship of simulation.ships?.() ?? []) {
      if (!ship.incoming) continue;
      for (const [ware, count] of Object.entries(ship.cargo)) {
        const request = COLONY_FOODS.includes(ware) ? FOOD : ware;
        if (demand[request]) demand[request] = Math.max(0, demand[request]! - count);
      }
    }
    if (!buildings || !hasGoods(demand)) return;
    const taken = takeFromStorages(buildings, demand);
    if (!hasGoods(taken)) { options.notify("The home island has no planks, stone or food to send."); return; }
    const island = findColony(options.group(), options.group().active)?.island;
    if (simulation.sendVisitorShip(taken, [], "supply", [], visitorVoyageSeconds(island)) === null) {
      addToHome(buildings, taken); return;
    }
    options.notify(`Supply ship from home: ${describeWares(taken)}.`);
  };
  const collectOreAbroad = () => {
    const group = options.group(), colony = findColony(group, group.active), state = simulation.colony();
    if (!colony || state?.status !== "conquered") return;
    if ((simulation.ships?.() ?? []).some(ship => ship.visitorRole === "ore")) return;
    const buildings = simulation.buildings();
    const advanced = colonyAdvancedCargo(buildings);
    const ore = colonyOreWare(colony.island);
    const storedOre = buildings.reduce((sum, building) => sum + (building.construction === 1 &&
      [0, 29, 39].includes(building.typeId) ? building.inventory[ore] ?? 0 : 0), 0);
    const ready = storedOre >= wareBoxUnits(ore) || Object.entries(advanced)
      .some(([ware, count]) => count >= wareBoxUnits(ware));
    if (!ready && (colony.nextOreShipAt ?? Infinity) > options.now()) return;
    const ship = simulation.sendVisitorShip({}, [...Object.keys(advanced), ore], "ore", [],
      visitorVoyageSeconds(colony.island), colony.expeditionId);
    if (ship !== null)
      options.setGroup(setNextOreShip(group, colony.expeditionId, options.now() + oreShipInterval()));
  };
  const shipOreHome = () => {
    const now = options.now();
    for (const colony of options.group().colonies) {
      if (options.ownsArchivedIsland?.(colony.expeditionId)) continue;
      if (colony.status !== "conquered" || !colony.save || (colony.nextOreShipAt ?? Infinity) > now) continue;
      const interval = oreShipInterval();
      const hours = Math.floor((now - colony.nextOreShipAt!) / interval) + 1;
      const food = COLONY_FOODS.reduce((sum, ware) => sum + (simulation.resourceTotal(ware)), 0);
      const mines = completedMines(colony.save.settlement.buildings);
      const nativeShipment = colony.nativeEconomy
        ? settleColonyNativeOre(colony.nativeEconomy, colony.nextOreShipAt!, interval, hours, mines, food) : undefined;
      const shipment = nativeShipment ?? abstractOreShipment(mines, hours, food);
      const scheduled = setNextOreShip(options.group(), colony.expeditionId, colony.nextOreShipAt! + hours * interval);
      if (nativeShipment) scheduled.colonies = scheduled.colonies.map(record => record.expeditionId === colony.expeditionId
        ? { ...record, nativeEconomy: nativeShipment.nativeEconomy } : record);
      options.setGroup(scheduled);
      const oreCargo = shipment.ore ? { [colonyOreWare(colony.island)]: shipment.ore } : {};
      const advanced = takeFromStorages(colony.save.settlement.buildings,
        colonyAdvancedCargo(colony.save.settlement.buildings));
      const cargo = { ...oreCargo, ...advanced };
      if (!hasGoods(cargo)) continue;
      simulation.takeStoredGoods({ [FOOD]: shipment.food });
      if (simulation.sendVisitorShip(cargo, [], "ore", [],
        visitorVoyageSeconds(colony.island), colony.expeditionId) === null) {
        simulation.receiveHomeGoods(oreCargo);
        addToHome(savedStorageBuildings(colony.save.settlement), advanced);
      }
      options.notify(`Resource ship from ${colony.island.name}: ${describeWares(cargo)}.`);
    }
  };
  return {
    settleEvacuations: troopShips.evacuateAll,
    /** Wares an ore ship loaded on the colony arrive in the filed home stock. */
    receiveAbroad: (goods: Goods) => {
      const buildings = homeBuildings();
      if (!buildings || !addToHome(buildings, goods)) return;
      options.notify(`Ore ship sailed home with ${describeWares(goods)}.`);
    },
    update: (dt: number) => {
      // Real native ticks own the filed home; defer direct supply/troop/evacuation mutations.
      if (options.group().active !== null && options.ownsArchivedIsland?.(null)) return;
      if (options.group().active === null) {
        homeTime += dt;
        if (homeTime < HOME_CHECK_SECONDS) return;
        homeTime = 0; shipOreHome(); troopShips.evacuateAll(); return;
      }
      const group = options.group();
      // Adventures are fought with the landed troops only: no supply or ore ships.
      if (findAdventure(group, group.active)) return;
      supplyTime += dt;
      if (supplyTime >= COLONY_SUPPLY_SECONDS) {
        supplyTime = 0; sendSupplies();
      }
      collectOreAbroad();
      garrisonTime += dt;
      if (garrisonTime >= HOME_CHECK_SECONDS) { garrisonTime = 0; troopShips.sendTroops(); }
    }
  };
};
