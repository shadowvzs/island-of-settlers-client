import { catapultGroundGoods } from "./catapult-ammo-kinds";
import type { GameSaveV1 } from "./game-save";
import { addGood, STORAGE_IDS } from "./production-rules";
import { savedCommanderManifest } from "./settlement-commander-transport";
import { isOwnBuilding, isOwnHeadquarters } from "./settlement-home";
import type { EmigratedTroop } from "./settlement-military";
import { grantSavedReserves } from "./settlement-military-storage";
import { ownerOf } from "./settlement-ownership";
import type { Goods } from "./settlement-types";
import { isSharedStorageWare } from "./shared-storage";

export interface ColonyExpiryAssets { cargo: Goods; troops: EmigratedTroop[] }
/**
 * Collect each physical receipt once; reservations and spent construction costs are not stock. The
 * colony's people stay behind (owner 2026-10-20); the tools they carry still return.
 */
export const colonyExpiryAssets = (game?: GameSaveV1): ColonyExpiryAssets => {
  const save = game?.settlement, cargo: Goods = {}, troops: EmigratedTroop[] = [];
  const commander = save?.military?.commander;
  const relief = new Map((save?.reliefCollections?.jobs ?? []).map(job => [job.questId, job]));
  const add = (goods?: Goods) => { for (const [ware, count] of Object.entries(goods ?? {})) if (count > 0) addGood(cargo, ware, count); };
  const pools = new Set<number>();
  for (const pool of save?.storagePools?.pools ?? []) {
    if (pool.owner !== 0 || pools.has(pool.id)) continue;
    pools.add(pool.id); add(pool.available);
  }
  for (const bin of save?.storagePools?.stranded ?? []) if (bin.owner === 0) add(bin.goods);
  const enemyIds = new Set((save?.military?.soldiers ?? []).filter(s => (s.combat?.faction ?? 0) > 0).map(s => s.actor));
  for (const building of save?.buildings ?? []) {
    if (ownerOf(building) > 0) continue;
    // Runtime inventory views enumerate the same pool at every door; only local equipment is per door.
    if (building.storagePoolId !== undefined) add(Object.fromEntries(Object.entries(building.inventory)
      .filter(([ware]) => !isSharedStorageWare(ware))));
    else add(building.inventory);
    add(building.input); add(building.output); add(building.workshopUpgrade?.reserved);
    add(catapultGroundGoods(building.catapultSupply));
    if (building.handcarts) addGood(cargo, "handcart", building.handcarts);
  }
  for (const soldier of save?.military?.soldiers ?? []) {
    if ((soldier.combat?.faction ?? 0) !== 0) continue;
    const hp = soldier.combat?.hp ?? 1;
    const manifest = commander && soldier.commanderId === commander.id
      ? savedCommanderManifest(commander, hp, commander.operationId ?? 1,
        commander.transport?.destinationName ?? "Colony") : undefined;
    troops.push({ type: soldier.combat?.type ?? "shield", rank: soldier.rank, hp,
      ...(manifest ? { commander: manifest } : {}),
      ...(soldier.recoverySeconds !== undefined ? { recoverySeconds: soldier.recoverySeconds } : {}) });
  }
  const finished = new Set(["returnWork", "outputWalk", "outputPutdown", "deposit", "outputFullReturn", "returnBlocked", "rest", "inside", "workSearchWait"]);
  for (const actor of save?.actors ?? []) {
    if (actor.phase === "retired" || enemyIds.has(actor.uid)) continue;
    if (actor.job !== "Mount" && actor.job !== "Soldier" && actor.tool) addGood(cargo, actor.tool);
    const unpaid = !finished.has(actor.phase) ? actor.consumed : undefined;
    add(unpaid); add(actor.demolitionCargo);
    if (actor.ware && !(unpaid?.[actor.ware] ?? 0)) addGood(cargo, actor.ware, actor.wareUnits ?? 1);
    if (actor.handcart) {
      addGood(cargo, "handcart");
      const trip = actor.handcart.trip;
      if (trip) addGood(cargo, trip.ware, actor.handcart.cargo + trip.prepaid);
    }
  }
  for (const job of relief.values()) if (!job.departed && !job.loaded) {
    for (const row of job.escrow.held) add(row.goods);
    add(job.escrow.staged);
  }
  for (const preparation of save?.naval?.preparation?.preparations ?? []) add(preparation.cargo);
  for (const expedition of save?.naval?.colonies?.expeditions ?? []) add(expedition.cargo);
  for (const job of save?.naval?.fleet.shuttles?.jobs ?? []) {
    add(job.cargo);
    if (!(save?.buildings ?? []).some(building => building.uid === (job.homeUid ?? job.sourceUid)))
      addGood(cargo, "boat");
  }
  // shipReserve is already owned by the corresponding pending order/loading manifest below.
  // Adding that private balance again would double-count the same cargo.
  const assigned = new Set((save?.naval?.fleet.ships ?? []).map(ship => ship.orderId));
  for (const order of save?.naval?.fleet.orders ?? []) if (!assigned.has(order.id)) add(order.cargo);
  for (const ship of save?.naval?.fleet.ships ?? []) {
    if (ship.lighters && !(save?.buildings ?? []).some(building => building.uid === ship.lighters!.harbourUid))
      addGood(cargo, "boat", ship.lighters.plan.lighters);
    const job = ship.visitor?.relief && relief.get(ship.visitor.relief.questId);
    if (!job || !job.departed && job.loaded > 0) add(ship.cargo);
    troops.push(...(ship.troops ?? []).map(troop => ({ ...troop })));
  }
  return { cargo, troops };
};

/** Credit returned wares to the actual saved home pool, and local equipment to its home depot. */
export const creditExpiredColony = (game: GameSaveV1, assets: ColonyExpiryAssets): GameSaveV1 => {
  const settlement = { ...game.settlement,
    storagePools: { ...game.settlement.storagePools,
      stranded: game.settlement.storagePools.stranded?.map(bin => ({ ...bin, goods: { ...bin.goods } })), pools: game.settlement.storagePools.pools.map(pool =>
      ({ ...pool, available: { ...pool.available } })) },
    buildings: game.settlement.buildings.map(building => ({ ...building, inventory: { ...building.inventory } })),
    actors: [...game.settlement.actors],
    military: game.settlement.military && { ...game.settlement.military, soldiers: [...game.settlement.military.soldiers] } };
  const completedOwn = settlement.buildings.filter(building => building.construction === 1 &&
    isOwnBuilding(building) && STORAGE_IDS.has(building.typeId));
  const home = completedOwn.find(isOwnHeadquarters) ??
    completedOwn.find(building => building.colonyHome);
  const pool = home && settlement.storagePools.pools.find(entry => entry.id === home.storagePoolId && entry.owner === 0);
  if (!home || !pool) throw new Error("The home island has no storage for colony evacuation");
  for (const [ware, count] of Object.entries(assets.cargo))
    addGood(isSharedStorageWare(ware) ? pool.available : home.inventory, ware, count);
  grantSavedReserves(settlement, assets.troops, home);
  return { ...game, settlement };
};
