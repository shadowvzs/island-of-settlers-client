import { MAX_TAVERN_ORDER, TAVERN_EQUIPMENT_BUFFER, TAVERN_TRAINING_SECONDS } from "../balance/military";
import { countIslandAction } from "../script-world/script-action-counters";
import { emitSoldierRecruited } from "../script-world/script-unit-events";
import { TAVERN_TYPE_ID } from "./building-type-ids";
import type { MilitaryTroopType } from "./military-combat-rules";
import { addGood, STORAGE_IDS } from "./production-rules";
import { returnCarrierHome } from "./settlement-carrier-home";
import { canEnterDoor, entrancePath, exitPath } from "./settlement-entrance";
import { localStockSources, sharesLocalStockPool } from "./settlement-local-stock";
import type { createSettlementMilitary } from "./settlement-military";
import { economyOwnerOf, ownerOf, PLAYER_FACTION } from "./settlement-ownership";
import { createActor, moveActor, setActorPath } from "./settlement-paths";
import { availableIdleSettlers } from "./settlement-population";
import { talentsOf } from "./settlement-talents";
import {
  createTavernState, type SettlementTavernSave, type TavernBatch
} from "./settlement-tavern-state";
import type { Goods, SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";
import { noteSettlerDemand } from "./settler-relocation";
import {
  isTavernTroop, missingTavernIngredients, TAVERN_RECIPES, tavernCarriedWares
} from "./tavern-rules";
import { wareNameForCount } from "./ware-names";
import { tavernTrainingFactor } from "./workshop-upgrades";

type Military = ReturnType<typeof createSettlementMilitary>;
export type TavernResult = { ok: true } | { ok: false; reason: string };
export interface TavernSnapshot {
  uid: number;
  queue: ReadonlyArray<{ count: number; type: MilitaryTroopType }>;
  current: { stage: TavernBatch["stage"]; type: MilitaryTroopType } | null;
}

/** "Missing 10 swords, 1 armor set": counts with the ware name in the right number, lower case. */
const describeMissing = (missing: readonly { count: number; ware: string }[]) =>
  `Missing ${missing.map(entry => `${entry.count} ${wareNameForCount(entry.ware, entry.count).toLowerCase()}`)
    .join(", ")}`;

/**
 * Tavern recruiting (owner decision 2026-10-12): orders are accepted only when the road-connected
 * storages hold every ingredient. Carriers bring the wares and a free settler arrives last, is
 * equipped inside and walks to the nearest storage as a soldier. Ordinary cavalry is retired
 * (HORSE-RETIREMENT-01).
 */
export const createSettlementTavern = (context: SettlementContext, military: Military) => {
  const state = createTavernState();
  const { batches, orders } = state;
  const actorById = (uid: number | undefined) => context.actors.find(actor => actor.uid === uid);
  const isTavern = (building: SettlementBuilding) =>
    building.typeId === TAVERN_TYPE_ID && building.construction === 1;
  /** Completed taverns of one economy; player commands read the player's (EAI1a D7). */
  const taverns = (owner = PLAYER_FACTION) => context.buildings.filter(building =>
    isTavern(building) && ownerOf(building) === owner);
  const tavernById = (uid: number, owner = PLAYER_FACTION) => taverns(owner).find(building => building.uid === uid);
  /**
   * The taverns that recruit this tick: the player's, and a computer economy's while its AI has ordered recruits
   * (EAI4a); a computer tavern without orders is left as it stands, so islands without such orders keep their state.
   */
  const recruitingTaverns = () => context.buildings.filter(building => isTavern(building) &&
    (ownerOf(building) === PLAYER_FACTION || orders.has(building.uid) || batches.has(building.uid)));
  /** A recruiting tavern of any economy (the logistics demand asks every building). */
  const anyTavernById = (uid: number) => {
    const building = context.buildings.find(entry => entry.uid === uid);
    return building && isTavern(building) ? building : undefined;
  };
  /** Completed storages of the Tavern's owner with a road to it, nearest first. */
  const storages = (tavern: SettlementBuilding) => context.buildings
    .filter(home => home.construction === 1 && STORAGE_IDS.has(home.typeId) &&
      ownerOf(home) === economyOwnerOf(context, tavern) &&
      sharesLocalStockPool(context, tavern.access, home))
    .map(home => ({ home, route: context.options.roads.route(home.access, tavern.access) }))
    .filter((entry): entry is { home: SettlementBuilding; route: NonNullable<typeof entry.route> } =>
      Boolean(entry.route))
    .sort((a, b) => a.route.cost - b.route.cost || a.home.uid - b.home.uid);

  /** Ingredients already promised to queued recruits of every Tavern, not yet delivered. */
  const promised = (target: SettlementBuilding) => {
    const goods: Goods = {};
    let settlers = 0;
    for (const [uid, queue] of orders) {
      const batch = batches.get(uid), tavern = context.buildings.find(building => building.uid === uid);
      if (!tavern || !sharesLocalStockPool(context, target.access, tavern)) continue;
      const needed: Goods = {};
      for (const order of queue) {
        if (!isTavernTroop(order.type)) continue;
        for (const [ware, each] of Object.entries(TAVERN_RECIPES[order.type]))
          addGood(needed, ware, each * order.count);
        settlers += order.count;
      }
      if (batch?.recruit !== undefined) settlers--;
      if (batch?.stage === "train")
        for (const [ware, each] of Object.entries(tavernCarriedWares(batch.type))) addGood(needed, ware, -each);
      for (const [ware, count] of Object.entries(needed))
        addGood(goods, ware, Math.max(0, count - (tavern?.input[ware] ?? 0) - (tavern?.incoming[ware] ?? 0)));
    }
    return { goods, settlers };
  };
  /** What the connected storages can still offer, after what earlier orders have promised. */
  const supplies = (tavern: SettlementBuilding) => {
    const reserved = promised(tavern), goods: Goods = {};
    let settlers = -reserved.settlers;
    const connected = storages(tavern).map(entry => entry.home);
    for (const home of localStockSources(context, tavern.access, connected))
      for (const [ware, count] of Object.entries(home.inventory)) addGood(goods, ware, count);
    for (const home of connected) settlers += availableIdleSettlers(context, home);
    for (const [ware, count] of Object.entries(reserved.goods)) goods[ware] = (goods[ware] ?? 0) - count;
    return { goods, settlers, reserved: reserved.goods };
  };

  /** `owner`: the economy that orders (the player's command, or a computer economy's AI, EAI4a). */
  const orderRecruits = (uid: number, type: unknown, count: number, owner = PLAYER_FACTION): TavernResult => {
    const tavern = tavernById(uid, owner);
    if (!tavern) return { ok: false, reason: "Finish the Military Academy first" };
    if (type === "cavalry") return { ok: false, reason: "Ordinary cavalry is retired" };
    if (!isTavernTroop(type) || !Number.isSafeInteger(count) || count < 1 || count > MAX_TAVERN_ORDER)
      return { ok: false, reason: "Choose a troop type and a count" };
    if (!storages(tavern).length) return { ok: false, reason: "Connect the Military Academy to a storehouse by road" };
    const available = supplies(tavern);
    const missing = missingTavernIngredients(type, count, available);
    if (missing.length) {
      const reserved = missing.filter(entry => (available.reserved[entry.ware] ?? 0) > 0)
        .map(entry => `${available.reserved[entry.ware]} ${wareNameForCount(entry.ware,
          available.reserved[entry.ware]!).toLowerCase()}`);
      const explanation = reserved.length ? `; ${reserved.join(", ")} reserved for queued recruits` : "";
      return { ok: false, reason: describeMissing(missing) + explanation };
    }
    const queue = orders.get(uid) ?? [];
    const last = queue.at(-1);
    if (last?.type === type) last.count += count;
    else queue.push({ count, type });
    orders.set(uid, queue);
    return { ok: true };
  };

  /** A bounded batch of the current queued type; already delivered/incoming equipment is owned here. */
  const demand = (uid: number): Goods => {
    const batch = batches.get(uid), tavern = batch && anyTavernById(uid);
    if (!batch || !tavern || batch.stage !== "collect") return {};
    const queued = orders.get(uid)?.[0];
    const count = Math.min(TAVERN_EQUIPMENT_BUFFER, queued?.count ?? 1);
    return Object.fromEntries(Object.entries(tavernCarriedWares(batch.type)).map(([ware, each]) =>
      [ware, Math.max(0, each * count - (tavern.input[ware] ?? 0) - (tavern.incoming[ware] ?? 0))]));
  };
  const delivered = (tavern: SettlementBuilding, type: MilitaryTroopType) =>
    isTavernTroop(type) &&
    Object.entries(tavernCarriedWares(type)).every(([ware, each]) => (tavern.input[ware] ?? 0) >= each);

  /** The settler comes last, from the nearest connected storage with a free settler. */
  const dispatchRecruit = (tavern: SettlementBuilding, batch: TavernBatch) => {
    const near = storages(tavern), source = near.find(({ home }) => availableIdleSettlers(context, home) > 0);
    if (near[0] && near[0] !== source) noteSettlerDemand(context, near[0].home);
    if (!source) return;
    const actor = createActor(context, "Recruit", source.home.uid, tavern.uid);
    setActorPath(actor, [...exitPath(source.home), ...source.route.points], "assigned");
    batch.recruit = actor.uid;
    batch.stage = "settler";
  };
  const consumeIngredients = (tavern: SettlementBuilding, type: MilitaryTroopType) => {
    if (!isTavernTroop(type)) return;
    for (const [ware, each] of Object.entries(TAVERN_RECIPES[type])) addGood(tavern.input, ware, -each);
  };
  const finishRecruit = (tavern: SettlementBuilding, batch: TavernBatch) => {
    const actor = actorById(batch.recruit);
    if (!actor) return;
    if (!military.enlist(actor, tavern, batch.type)) {
      tavern.status = "Connect a storehouse: the recruit waits inside";
      return;
    }
    countIslandAction(context, "recruit");
    if (context.script) emitSoldierRecruited(context, actor, tavern);
    batches.delete(tavern.uid);
    const queue = orders.get(tavern.uid)!;
    if (--queue[0]!.count <= 0) queue.shift();
    if (!queue.length) orders.delete(tavern.uid);
  };

  const startBatch = (tavern: SettlementBuilding) => {
    const next = orders.get(tavern.uid)?.[0];
    if (!next || tavern.worker === undefined) return undefined;
    const batch: TavernBatch = { stage: "collect", timer: 0, type: next.type };
    batches.set(tavern.uid, batch);
    return batch;
  };
  const advanceBatch = (tavern: SettlementBuilding, batch: TavernBatch, dt: number) => {
    if (batch.stage === "collect" && delivered(tavern, batch.type))
      batch.stage = "settler";
    if (batch.stage === "settler" && batch.recruit === undefined) dispatchRecruit(tavern, batch);
    if (batch.stage !== "train") return;
    const talents = talentsOf(context, ownerOf(tavern));
    batch.timer -= dt * tavernTrainingFactor(tavern, talents.recruitTrainingSpeed, context);
    if (batch.timer <= 0) finishRecruit(tavern, batch);
  };
  const statusOf = (tavern: SettlementBuilding) => {
    const batch = batches.get(tavern.uid);
    const waiting = (orders.get(tavern.uid) ?? []).reduce((sum, order) => sum + order.count, 0);
    if (!batch) return waiting ? "Waiting for the innkeeper" : "Ready to recruit";
    const label = `${waiting} recruit${waiting === 1 ? "" : "s"}`;
    if (batch.stage === "collect") return `Recruiting ${label}: carriers bring the equipment`;
    if (batch.stage === "settler") return `Recruiting ${label}: a settler is on the way`;
    return `Recruiting ${label}: equipping inside`;
  };
  const update = (dt: number) => {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (const tavern of recruitingTaverns()) {
      const batch = batches.get(tavern.uid) ?? startBatch(tavern);
      if (batch) advanceBatch(tavern, batch, dt);
      tavern.status = statusOf(tavern);
      tavern.working = batch?.stage === "train";
    }
  };

  /** Recruits walk in through the Tavern door, then stay inside while they are equipped. */
  const updateActor = (actor: SettlementActor, dt: number) => {
    if (actor.job !== "Recruit") return false;
    const tavern = context.buildings.find(building => building.uid === actor.building);
    const batch = tavern && batches.get(tavern.uid);
    if (!tavern || !batch || actor.phase === "tavernTraining" || !moveActor(context, actor, dt)) return true;
    if (actor.phase === "assigned") {
      if (canEnterDoor(context, actor, tavern)) setActorPath(actor, entrancePath(tavern), "enterAssigned");
      else actor.action = "idle";
      return true;
    }
    Object.assign(actor, { action: "idle", path: [], pathIndex: 0, phase: "tavernTraining", visible: false });
    tavern.door = 1;
    consumeIngredients(tavern, batch.type);
    batch.stage = "train";
    batch.timer = TAVERN_TRAINING_SECONDS;
    return true;
  };

  /** Demolition: unspent equipment stays in the Tavern stock; walkers return to storage. */
  const removeBuilding = (uid: number) => {
    const batch = batches.get(uid);
    batches.delete(uid);
    orders.delete(uid);
    if (!batch) return;
    const tavern = context.buildings.find(building => building.uid === uid);
    const recruit = actorById(batch.recruit);
    if (recruit && tavern) releaseLegacyRecruit(recruit, tavern);
  };

  /**
   * Raiders destroyed the Academy (owner 2026-11-09): the batch is cancelled and the equipment a
   * recruit in training already took is put back into its stock, which the removal then returns.
   */
  const destroyBuilding = (uid: number) => {
    const batch = batches.get(uid), tavern = context.buildings.find(building => building.uid === uid);
    if (batch?.stage === "train" && tavern && isTavernTroop(batch.type))
      for (const [ware, each] of Object.entries(TAVERN_RECIPES[batch.type])) addGood(tavern.input, ware, each);
    removeBuilding(uid);
  };

  const releaseLegacyRecruit = (recruit: SettlementActor, tavern: SettlementBuilding) => {
    Object.assign(recruit, { job: "Carrier", visible: true, ...(recruit.visible ? {} : tavern.doorThreshold) });
    if (!returnCarrierHome(context, recruit, tavern)) Object.assign(recruit, { action: "idle", phase: "home" });
  };

  /** Recruits still queued at the taverns of `owner` (the economy AI's soldier count, EAI4a). */
  const queuedRecruits = (owner: number) => {
    let queued = 0;
    for (const [uid, queue] of orders) {
      const tavern = anyTavernById(uid);
      if (tavern && ownerOf(tavern) === owner) for (const order of queue) queued += order.count;
    }
    return queued;
  };

  return {
    demand, destroyBuilding, orderRecruits, queuedRecruits, removeBuilding, update, updateActor,
    snapshot: (): TavernSnapshot[] => taverns().map(tavern => {
      const batch = batches.get(tavern.uid);
      return { current: batch ? { stage: batch.stage, type: batch.type } : null, uid: tavern.uid,
        queue: (orders.get(tavern.uid) ?? []).map(order => ({ ...order })) };
    }),
    saveState: state.save,
    restore: (saved?: SettlementTavernSave) => state.restore(saved)
  };
};
