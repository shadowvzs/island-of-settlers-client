import { COLONY_CREW, COLONY_LIMIT, COLONY_SUPPLIES, TROOP_DECK_SLOTS } from "../balance/colonies";
import { activeOperation } from "../campaign/active-operation";
import type { CampaignLaunchRequirements } from "../campaign/campaign-requirements";
import { reducedDuration } from "../progression/talents";
import { countIslandAction } from "../script-world/script-action-counters";
import { type AdventureIsland,adventureOffers, isAdventureIsland } from "./adventure-rules";
import { takeCampaignCargo } from "./campaign-departure";
import {
  COLONY_TROOP_TYPES, colonyArrivalSeconds, colonyDeckItems, type ColonyIsland,
colonyIslandOffers, type ColonyShipLoad, type ColonyTroops, packColonyLoads} from "./colony-expedition-rules";
import { normalizeColonyRound, replenishColonyOffer } from "./colony-offer-replenishment";
import { debugExpeditionIsland } from "./expedition-debug-rules";
import { isIdleExpeditionShip } from "./expedition-launch-rules";
import { featureRefusal } from "./feature-rules";
import { optionsNow } from "./game-clock";
import { harbourHelperSupply } from "./harbour-helper-supply";
import { cloneDiscoveredIsland, createDiscoveryCalendar, discoverIslandClimate,
type DiscoveryOverride,  discoveryOverrideError } from "./island-discovery-policy";
import type { MilitaryTroopType } from "./military-combat-rules";
import { expeditionReserveSoldiers } from "./naval-passenger-eligibility";
import { dropNavalPerson } from "./naval-person-release";
import { addGood } from "./production-rules";
import {
  colonyCommanderMusterStep, colonyCommanderSnapshot, colonyCommanderStatus
} from "./settlement-colony-commander";
import { createColonyPlanning } from "./settlement-colony-planning";
import { COMMANDER_DECK_SLOTS } from "./settlement-commander-transport";
import type { EmigratedTroop } from "./settlement-military";
import type { createNavalFleet, NavalColonyEvent, NavalColonyVoyage } from "./settlement-naval-fleet";
import type { createNavalPassengers } from "./settlement-naval-passengers";
import { countOnDuty } from "./settlement-population";
import { voyageTalentReduction } from "./settlement-talents";
import type { Goods, SettlementBuilding, SettlementContext } from "./settlement-types";
import { shipTravelSeconds } from "./ship-travel-time";
import { contextPlayerLevel } from "./sim-rules";

type ColonyExpeditionStatus = "preparing" | "sailing" | "arrived";
/** A colony expedition sails to a colony island, an adventure expedition (troops only) to an adventure. */
export type ExpeditionIsland = ColonyIsland | AdventureIsland;
interface ColonyEmigrant { job: "Builder" | "Carrier" | "Soldier"; troop?: EmigratedTroop }
export interface ColonyExpedition {
  id: number;
  sourceUid: number;
  island: ExpeditionIsland;
  status: ColonyExpeditionStatus;
  troops: ColonyTroops;
  /** Paid supplies held by the expedition until its loads are handed to the fleet. */
  cargo: Goods;
  /** Builder first, then carrier; gathered from settlers stored in the harbour. Empty on adventures. */
  crew: number[];
  /** Reserved stored soldiers. */
  passengers: number[];
  /** Claimed commander roster identity and its live actor while gathering/boarding. */
  commanderId?: string;
  commanderUid?: number;
  /** A saved blocked reason for the commander's muster/boarding step. */
  commanderBlocked?: string;
  loads: number;
  departed: number;
  arrived: number;
  emigrants: ColonyEmigrant[];
  landed: Goods;
  /** Game seconds since the loads were handed to the fleet. */
  elapsed: number;
  estimate: number;
}
export interface ColonyExpeditionState {
  nextExpedition: number;
  expeditions: ColonyExpedition[];
  /** Finished adventures; each one brings a new set of adventure offers. */
  adventureRound?: number;
  /** Consumed colony offer identities; advanced only after a first real ship departure. */
  colonyRound?: number;
  discoveryVersion?: 1;
  discoveryTimeZone?: string;
  colonyOffers?: ColonyIsland[];
  adventureOffers?: AdventureIsland[];
}
export interface ColonyExpeditionSnapshot {
  id: number;
  sourceUid: number;
  island: ExpeditionIsland;
  status: ColonyExpeditionStatus;
  troops: ColonyTroops;
  cargo: Goods;
  landed: Goods;
  crewReady: boolean;
  suppliesReady: boolean;
  loads: number;
  departed: number;
  arrived: number;
  remainingSeconds: number | null;
  returningShips?: number;
  /** Claimed commander manifest/status while the expedition prepares, sails or arrives. */
  commander?: {
    blockDetail: string | null;
    deckSlots: number;
    hp: number;
    id: string;
    level: number;
    maximumHp: number;
    name: string;
    phase?: string;
    xp: number;
  };
}
export interface ColonyExpeditionPlan {
  ships: number;
  loads: number;
  trips: number;
  seconds: number;
  requiredSoldiers?: number;
  launchReason?: string | null;
  /** Deck places a selected commander (rider and mount) reserves before packing. */
  commanderDeckSlots?: number;
  /** One unit of the difficulty's troop cap when a commander is selected. */
  commanderTroopCap?: number;
  /** The commander's availability/refusal detail, if any. */
  commanderReason?: string | null;
}
interface ColonyHooks {
  fleet: Pick<ReturnType<typeof createNavalFleet>, "canQueue" | "cancelTransport" | "pending" | "queueTransport" |
    "seaExit" | "snapshot">;
  passengers: Pick<ReturnType<typeof createNavalPassengers>, "reserveChosen" | "release" | "ready">;
  onArrived?: (expedition: ColonyExpedition) => void;
}

const PREPARATION_RETRY_SECONDS = 0.5;
const NO_SUPPLIES: Readonly<Goods> = Object.freeze({});
/** New expeditions may select only ordinary troops; cavalry remains a legacy deck type. */
const TROOP_TYPES = COLONY_TROOP_TYPES;
const cloneExpedition = (expedition: ColonyExpedition): ColonyExpedition => ({
  ...expedition, cargo: { ...expedition.cargo }, crew: expedition.crew.slice(),
  emigrants: expedition.emigrants.map(entry => ({ ...entry })), island: cloneDiscoveredIsland(expedition.island),
  landed: { ...expedition.landed }, passengers: expedition.passengers.slice(), troops: { ...expedition.troops }
});
const isAdventure = (expedition: Pick<ColonyExpedition, "island">) => isAdventureIsland(expedition.island);
/** Adventures sail with troops only. */
const suppliesOf = (island: ExpeditionIsland) => isAdventureIsland(island) ? NO_SUPPLIES : COLONY_SUPPLIES;
const crewOf = (island: ExpeditionIsland) => isAdventureIsland(island) ? 0 : COLONY_CREW;
const fullTroops = (troops: Partial<ColonyTroops>) => Object.fromEntries(
  (Object.keys(TROOP_DECK_SLOTS) as MilitaryTroopType[]).map(type => [type, troops[type] ?? 0])) as ColonyTroops;

/** A saved snapshot of one expedition, including the commander's live manifest state. */
const colonyExpeditionSnapshot = (
  expedition: ColonyExpedition, context: SettlementContext, hooks: ColonyHooks,
  crewReady: (expedition: ColonyExpedition) => boolean,
  suppliesReady: (expedition: ColonyExpedition) => boolean
): ColonyExpeditionSnapshot => {
  const remaining = () => {
    if (expedition.status === "arrived") return 0;
    if (expedition.status === "preparing" || expedition.departed < expedition.loads) return null;
    const voyages = hooks.fleet.snapshot().filter(ship => ship.colony === expedition.id &&
      ship.awaySeconds !== undefined);
    return Math.max(0, ...voyages.map(ship => ship.awaySeconds! - shipTravelSeconds(expedition.island.voyageSeconds,
      voyageTalentReduction(context, isAdventureIsland(expedition.island)))));
  };
  const status = expedition.commanderId ? colonyCommanderStatus(context) : undefined;
  const commander = colonyCommanderSnapshot(expedition, status);
  return {
    returningShips: hooks.fleet.snapshot().filter(ship => ship.colony === expedition.id &&
      ship.awaySeconds !== undefined && ship.awaySeconds <= shipTravelSeconds(expedition.island.voyageSeconds)).length,
    arrived: expedition.arrived, cargo: { ...expedition.cargo },
    crewReady: expedition.status !== "preparing" || crewReady(expedition), departed: expedition.departed,
    id: expedition.id, island: cloneDiscoveredIsland(expedition.island), landed: { ...expedition.landed },
    loads: expedition.loads, remainingSeconds: remaining(), sourceUid: expedition.sourceUid,
    status: expedition.status, suppliesReady: expedition.status !== "preparing" || suppliesReady(expedition),
    troops: { ...expedition.troops }, ...(commander ? { commander } : {})
  };
};

/** A lost commander before the ship departs must not leave a silently stranded voyage. */
const commanderLost = (context: SettlementContext, expedition: ColonyExpedition) => {
  if (!expedition.commanderId) return false;
  const status = colonyCommanderStatus(context);
  return !status || status.id !== expedition.commanderId ||
    status.phase === undefined || status.phase === "returning";
};

const colonyStartReason = (
  hasHarbour: boolean, island: ExpeditionIsland | undefined, colonies: number, launch: () => string | null
) => {
  if (!hasHarbour) return "Choose a completed harbour";
  if (!island) return "Choose an island that is not already claimed";
  if (colonies >= COLONY_LIMIT) return `At most ${COLONY_LIMIT} colonies`;
  return launch();
};

const adventureStartReason = (
  hasHarbour: boolean, island: ExpeditionIsland | undefined, current: unknown, launch: () => string | null
) => {
  if (!hasHarbour) return "Choose a completed harbour";
  if (!island) return "Choose one of the offered adventures";
  if (current) return "Finish the current adventure first";
  return launch();
};

/** Colony and adventure expeditions own their supplies and crew until ships carry them past the map edge. */
export const createColonyExpeditions = (context: SettlementContext, hooks: ColonyHooks) => {
  const expeditions = new Map<number, ColonyExpedition>();
  let nextExpedition = 1, retryTime = 0, adventureRound = 0;
  let colonyRound = 0, discoveryVersion: 1 | undefined = 1, discoveryTimeZone: string | undefined;
  let colonyOffers: ColonyIsland[] | undefined, adventureBatch: AdventureIsland[] | undefined;
  const gameNow = () => optionsNow(context.options);
  let calendar = context.options.discoveryCalendar ?? createDiscoveryCalendar(gameNow);
  const ensureOffers = () => {
    if (colonyOffers && adventureBatch) return;
    const snapshot = calendar();
    discoveryTimeZone ??= snapshot.timeZone;
    colonyOffers ??= colonyIslandOffers(context.options.world.seed, undefined, snapshot,
      contextPlayerLevel(context) ?? 0);
    adventureBatch ??= adventureOffers(context.options.world.seed, adventureRound, snapshot);
    discoveryVersion = 1;
  };
  /** The island's voyage with the Shipping (colony) or adventure sailing talent, as the fleet sails it. */
  const talentVoyage = (island: ColonyExpedition["island"]) =>
    reducedDuration(island.voyageSeconds, voyageTalentReduction(context, isAdventureIsland(island)));
  const harbourOf = (uid: number) => context.buildings.find(building =>
    building.uid === uid && building.typeId === 39 && building.construction === 1);
  const ownShips = () => hooks.fleet.snapshot().filter(ship => !ship.visitor);
  const freeShips = () => ownShips().filter(isIdleExpeditionShip).length;
  const storedSoldiers = (type: MilitaryTroopType, sourceUid?: number) =>
    expeditionReserveSoldiers(context, type, sourceUid === undefined ? undefined : harbourOf(sourceUid));
  const availableTroops = (sourceUid?: number) =>
    Object.fromEntries(TROOP_TYPES.map(type => [type, storedSoldiers(type, sourceUid).length])) as ColonyTroops;
  const colonyCount = () => [...expeditions.values()].filter(expedition => !isAdventure(expedition)).length;
  const currentAdventure = () => [...expeditions.values()].find(isAdventure);
  const suppliesReady = (expedition: ColonyExpedition) => Object.entries(suppliesOf(expedition.island))
    .every(([ware, count]) => (expedition.cargo[ware] ?? 0) >= count);
  const crewReady = (expedition: ColonyExpedition) => expedition.crew.length === crewOf(expedition.island) &&
    hooks.passengers.ready([...expedition.crew, ...expedition.passengers]);
  const deckPassengers = (expedition: ColonyExpedition) => {
    const entries: Array<{ slots: number; uid: number }> = [];
    if (expedition.commanderUid !== undefined)
      entries.push({ slots: COMMANDER_DECK_SLOTS, uid: expedition.commanderUid });
    for (const uid of [...expedition.crew, ...expedition.passengers]) {
      const type = context.military?.troopType?.(uid);
      entries.push({ slots: type ? TROOP_DECK_SLOTS[type] : 1, uid });
    }
    return entries;
  };
  const plannedLoads = (expedition: ColonyExpedition) =>
    packColonyLoads(colonyDeckItems(deckPassengers(expedition), suppliesOf(expedition.island)));

  const collectSupplies = (expedition: ColonyExpedition, source: SettlementBuilding) => {
    for (const [ware, count] of Object.entries(suppliesOf(expedition.island))) {
      const amount = Math.min(count - (expedition.cargo[ware] ?? 0), source.inventory[ware] ?? 0);
      if (amount <= 0) continue;
      addGood(source.inventory, ware, -amount);
      addGood(expedition.cargo, ware, amount);
    }
  };
  /**
   * Queues every load or none: a refused later load withdraws the earlier ones (their reserved wares return
   * to stock, their passengers stay reserved by the expedition). Returns the order ids, or null.
   */
  const queueAllLoads = (
    loads: readonly ColonyShipLoad[], source: SettlementBuilding, voyage: (boxes: number) => NavalColonyVoyage
  ) => {
    const fits = loads.every(load => hooks.fleet.canQueue(source.uid, source.uid, load.cargo,
      load.passengers.length, undefined, undefined, voyage(load.boxes)));
    if (!fits) return null;
    const ids: number[] = [];
    for (const load of loads) {
      const id = hooks.fleet.queueTransport(source.uid, source.uid, load.cargo, load.passengers,
        undefined, undefined, voyage(load.boxes));
      if (id === null) {
        for (const queued of ids) hooks.fleet.cancelTransport(queued, false);
        return null;
      }
      ids.push(id);
    }
    return ids;
  };
  const queueLoads = (expedition: ColonyExpedition, source: SettlementBuilding) => {
    const exit = hooks.fleet.seaExit(source.uid);
    if (!exit) return false;
    const loads = plannedLoads(expedition);
    const voyage = (boxes: number): NavalColonyVoyage =>
      ({ boxes, exit, expeditionId: expedition.id, voyageSeconds: expedition.island.voyageSeconds,
        ...(isAdventureIsland(expedition.island) ? { adventure: true as const } : {}) });
    // The fleet debits ordinary harbour stock, so the held supplies return to it for the handover.
    for (const [ware, count] of Object.entries(expedition.cargo)) addGood(source.inventory, ware, count);
    const ids = queueAllLoads(loads, source, voyage);
    if (!ids) {
      for (const [ware, count] of Object.entries(expedition.cargo)) addGood(source.inventory, ware, -count);
      return false;
    }
    loads.forEach((load, index) => {
      for (const uid of load.passengers) context.actors.find(actor => actor.uid === uid)!.navalOrder = ids[index];
    });
    expedition.cargo = {};
    expedition.loads = loads.length;
    expedition.estimate = colonyArrivalSeconds(loads, Math.max(1, freeShips()), talentVoyage(expedition.island));
    expedition.status = "sailing";
    return true;
  };
  const gatherCrew = (expedition: ColonyExpedition, source: SettlementBuilding) => {
    const wanted = Math.min(crewOf(expedition.island) - expedition.crew.length, harbourHelperSupply(context, source));
    if (wanted <= 0) return;
    const ids = hooks.passengers.reserveChosen(source, wanted, []);
    if (ids) expedition.crew.push(...ids);
  };
  const updatePreparation = (expedition: ColonyExpedition) => {
    const source = harbourOf(expedition.sourceUid);
    if (!source) return;
    collectSupplies(expedition, source);
    gatherCrew(expedition, source);
    if (!colonyCommanderMusterStep(context, expedition)) return;
    if (!suppliesReady(expedition) || !crewReady(expedition) || !freeShips()) return;
    queueLoads(expedition, source);
  };
  const emigrate = (expedition: ColonyExpedition, passengers: readonly number[]) => {
    for (const uid of passengers) {
      const crewIndex = expedition.crew.indexOf(uid);
      if (crewIndex >= 0) {
        expedition.emigrants.push({ job: crewIndex === 0 ? "Builder" : "Carrier" });
        context.actors.splice(context.actors.findIndex(actor => actor.uid === uid), 1);
        countOnDuty(context, -1);
        continue;
      }
      const troop = context.military?.emigrate?.(uid);
      if (troop) expedition.emigrants.push({ job: "Soldier", troop });
    }
  };
  const onVoyage = (expeditionId: number, event: NavalColonyEvent, cargo: Goods, passengers: number[]) => {
    const expedition = expeditions.get(expeditionId);
    if (!expedition) return;
    if (event === "depart") {
      if (!expedition.departed && !isAdventure(expedition)) {
        ensureOffers();
        const snapshot = calendar();
        discoveryTimeZone ??= snapshot.timeZone;
        discoveryVersion = 1;
        const refreshed = replenishColonyOffer(context.options.world.seed, colonyOffers!,
          expedition.island as ColonyIsland, colonyRound, contextPlayerLevel(context) ?? 0, snapshot,
          [...expeditions.values()].filter(other => !isAdventure(other)).map(other => other.island as ColonyIsland));
        colonyOffers = refreshed.offers; colonyRound = refreshed.round;
      }
      expedition.departed++; emigrate(expedition, passengers); return;
    }
    expedition.arrived++;
    for (const [ware, count] of Object.entries(cargo)) addGood(expedition.landed, ware, count);
    if (expedition.arrived < expedition.loads) return;
    expedition.status = "arrived";
    hooks.onArrived?.(expedition);
  };
  const ongoing = () => [...expeditions.values()].some(expedition => expedition.status !== "arrived");
  const islands = () => {
    const taken = new Set([...expeditions.values()].filter(expedition => !isAdventure(expedition))
      .map(expedition => expedition.island.id));
    return colonyOffers!.map(island => ({ ...cloneDiscoveredIsland(island), taken: taken.has(island.id) }));
  };
  const adventureIslands = () => adventureBatch!.map(cloneDiscoveredIsland);
  const freeIsland = (islandId: number) => islands().find(island => island.id === islandId && !island.taken);
  const offeredAdventure = (islandId: number) => adventureIslands().find(island => island.id === islandId);
  const planning = createColonyPlanning({ availableTroops, context, freeShips, harbourOf,
    operation: () => activeOperation([...expeditions.values()]), talentVoyage });
  const startReason = (sourceUid: number, island: ExpeditionIsland | undefined,
    troops: Partial<ColonyTroops>, commanderId?: string) => featureRefusal(context, "colonies") ??
    colonyStartReason(Boolean(harbourOf(sourceUid)), island, colonyCount(), () =>
      planning.launchReason(sourceUid, island!, troops, commanderId));
  const adventureReason = (sourceUid: number, island: ExpeditionIsland | undefined,
    troops: Partial<ColonyTroops>, commanderId?: string) => featureRefusal(context, "adventures") ??
    adventureStartReason(Boolean(harbourOf(sourceUid)), island, currentAdventure(), () =>
      planning.launchReason(sourceUid, island!, troops, commanderId));
  const launch = (
    sourceUid: number, island: ExpeditionIsland, troops: Partial<ColonyTroops>, commanderId?: string
  ) => {
    const source = harbourOf(sourceUid)!;
    const soldierIds = TROOP_TYPES.flatMap(type =>
      storedSoldiers(type, sourceUid).slice(0, troops[type] ?? 0).map(actor => actor.uid));
    const id = nextExpedition;
    if (commanderId) {
      const claim = context.commander?.claimForExpedition(id, island.name);
      if (!claim?.ok) return { ok: false as const, reason: claim?.reason ?? "Commander is unavailable" };
    }
    const passengers = hooks.passengers.reserveChosen(source, 0, soldierIds);
    if (!passengers) {
      if (commanderId) context.commander?.releaseOperation();
      return { ok: false as const, reason: "Chosen troops cannot reach this harbour" };
    }
    nextExpedition++;
    const commanderUid = commanderId ? context.commander?.soldier()?.actor : undefined;
    const expedition: ColonyExpedition = { arrived: 0, cargo: {}, crew: [], departed: 0, elapsed: 0, emigrants: [],
      estimate: 0, id, island: cloneDiscoveredIsland(island), landed: {}, loads: 0, passengers, sourceUid, status: "preparing",
      troops: fullTroops(troops), ...(commanderId ? { commanderId } : {}),
      ...(commanderUid !== undefined ? { commanderUid } : {}) };
    expeditions.set(id, expedition);
    collectSupplies(expedition, source);
    gatherCrew(expedition, source);
    countIslandAction(context, "expedition");
    return { ok: true as const, id };
  };
  /** C8 simple departure: the launch gate again, then the cargo leaves at once (no loading or boarding). */
  const departCampaign = (sourceUid: number, launch: CampaignLaunchRequirements) => {
    const reason = planning.campaignRequirements(sourceUid, launch).reason;
    if (reason) return { ok: false as const, reason };
    const troops = takeCampaignCargo(context, harbourOf(sourceUid)!, launch.cargo,
      type => storedSoldiers(type, sourceUid));
    return { ok: true as const, troops };
  };
  /** A development menu test expedition sails the same island with test rules (expedition-debug-rules.ts). */
  const voyageIsland = <T extends ExpeditionIsland>(island: T | undefined, debug: boolean | DiscoveryOverride) => {
    if (!island || !debug) return island;
    if (typeof debug === "boolean") return debugExpeditionIsland(cloneDiscoveredIsland(island));
    return debugExpeditionIsland({ ...cloneDiscoveredIsland(island),
      ...discoverIslandClimate(island.seed, island.discovery?.baseVoyageSeconds ?? island.voyageSeconds, calendar(), debug) });
  };
  const start = (
    sourceUid: number, islandId: number, troops: Partial<ColonyTroops>, debug: boolean | DiscoveryOverride = false,
    commanderId?: string
  ) => {
    const invalid = typeof debug === "boolean" ? null : discoveryOverrideError(debug);
    if (invalid) return { ok: false as const, reason: invalid };
    const island = voyageIsland(freeIsland(islandId), debug);
    const reason = startReason(sourceUid, island, troops, commanderId);
    return reason ? { ok: false as const, reason } : launch(sourceUid, island!, troops, commanderId);
  };
  const startAdventure = (
    sourceUid: number, islandId: number, troops: Partial<ColonyTroops>, debug: boolean | DiscoveryOverride = false,
    commanderId?: string
  ) => {
    const invalid = typeof debug === "boolean" ? null : discoveryOverrideError(debug);
    if (invalid) return { ok: false as const, reason: invalid };
    const island = voyageIsland(offeredAdventure(islandId), debug);
    const reason = adventureReason(sourceUid, island, troops, commanderId);
    return reason ? { ok: false as const, reason } : launch(sourceUid, island!, troops, commanderId);
  };
  const cancel = (id: number) => {
    const expedition = expeditions.get(id), source = expedition && harbourOf(expedition.sourceUid);
    if (!expedition || !source) return false;
    const beforeDeparture = expedition.status === "preparing" ||
      (expedition.status === "sailing" && expedition.departed === 0);
    if (!beforeDeparture) return false;
    for (const order of hooks.fleet.pending())
      if (order.colony?.expeditionId === id) hooks.fleet.cancelTransport(order.id);
    for (const ship of hooks.fleet.snapshot())
      if (ship.colony === id && ship.orderId !== undefined) hooks.fleet.cancelTransport(ship.orderId);
    for (const [ware, count] of Object.entries(expedition.cargo)) addGood(source.inventory, ware, count);
    hooks.passengers.release([...expedition.crew, ...expedition.passengers], source);
    if (expedition.commanderId) context.commander?.recallToLodge();
    expeditions.delete(id);
    return true;
  };
  /** Frees the island and colony slot once a colony ends; a finished adventure brings new offers. */
  const release = (id: number) => {
    const expedition = expeditions.get(id);
    if (expedition?.status !== "arrived") return false;
    if (isAdventure(expedition)) { adventureRound++; adventureBatch = undefined; ensureOffers(); }
    return expeditions.delete(id);
  };

  // A shared initial/load boundary owns discovery, before any UI query or command interval.
  // Use the saved game clock/seed and keep persisted batches immutable across later reads.
  ensureOffers();
  return {
    /** A crew member lost on land: the expedition gathers another one. */
    forgetPerson: (uid: number) => { for (const expedition of expeditions.values()) dropNavalPerson(expedition, uid); },
    adventureIslands,
    availableTroops, campaignRequirements: planning.campaignRequirements,
    cancel,
    departCampaign,
    islands,
    /** Who and what landed; the colony or adventure island is seeded from it on the first visit. */
    landing: (id: number) => {
      const expedition = expeditions.get(id);
      if (expedition?.status !== "arrived") return null;
      return { crew: expedition.emigrants.filter(entry => entry.job !== "Soldier").length,
        landed: { ...expedition.landed },
        troops: expedition.emigrants.flatMap(entry => entry.troop ? [{ ...entry.troop }] : []) };
    },
    ongoing,
    release,
    demand: (uid: number): Goods => {
      const expedition = [...expeditions.values()].find(entry => entry.sourceUid === uid && entry.status === "preparing");
      const source = expedition && harbourOf(uid);
      if (!expedition || !source) return {};
      return Object.fromEntries(Object.entries(suppliesOf(expedition.island)).map(([ware, count]) =>
        [ware, Math.max(0, count - (expedition.cargo[ware] ?? 0) -
          (source.inventory[ware] ?? 0) - (source.incoming[ware] ?? 0))]));
    },
    onVoyage,
    plan: (sourceUid: number, islandId: number, troops: Partial<ColonyTroops>, commanderId?: string) =>
      planning.planFor(sourceUid, freeIsland(islandId), troops, commanderId),
    planAdventure: (sourceUid: number, islandId: number, troops: Partial<ColonyTroops>, commanderId?: string) =>
      planning.planFor(sourceUid, offeredAdventure(islandId) ?? adventureIslands()[0], troops, commanderId),
    removeBuilding: (uid: number) => {
      for (const expedition of expeditions.values()) if (expedition.sourceUid === uid) cancel(expedition.id);
    },
    restore: (saved?: ColonyExpeditionState) => {
      expeditions.clear();
      nextExpedition = saved?.nextExpedition ?? 1;
      adventureRound = saved?.adventureRound ?? 0;
      discoveryVersion = saved ? saved.discoveryVersion : 1;
      discoveryTimeZone = saved?.discoveryTimeZone;
      calendar = context.options.discoveryCalendar ?? createDiscoveryCalendar(gameNow);
      colonyOffers = saved?.colonyOffers?.map(cloneDiscoveredIsland);
      colonyRound = normalizeColonyRound(saved?.colonyRound, [
        ...colonyOffers ?? [], ...saved?.expeditions.filter(expedition => !isAdventure(expedition))
          .map(expedition => expedition.island) ?? []
      ]);
      adventureBatch = saved?.adventureOffers?.map(cloneDiscoveredIsland);
      // No timestamp migration: old undispatched previews retain the former seeded helper behavior.
      if (saved && !saved.discoveryVersion) {
        colonyOffers ??= colonyIslandOffers(context.options.world.seed);
        adventureBatch ??= adventureOffers(context.options.world.seed, adventureRound);
      }
      ensureOffers();
      for (const expedition of saved?.expeditions ?? []) expeditions.set(expedition.id, cloneExpedition(expedition));
    },
    saveState: (): ColonyExpeditionState => ({ ...(adventureRound ? { adventureRound } : {}),
      ...(colonyRound ? { colonyRound } : {}),
      ...(discoveryVersion ? { discoveryVersion } : {}), ...(discoveryTimeZone ? { discoveryTimeZone } : {}),
      ...(colonyOffers ? { colonyOffers: colonyOffers.map(cloneDiscoveredIsland) } : {}),
      ...(adventureBatch ? { adventureOffers: adventureBatch.map(cloneDiscoveredIsland) } : {}),
      expeditions: [...expeditions.values()].map(cloneExpedition), nextExpedition }),
    snapshot: (): ColonyExpeditionSnapshot[] => [...expeditions.values()].map(expedition =>
      colonyExpeditionSnapshot(expedition, context, hooks, crewReady, suppliesReady)),
    start,
    startAdventure,
    update: (dt: number) => {
      retryTime -= dt;
      const prepare = retryTime <= 0;
      if (prepare) retryTime = PREPARATION_RETRY_SECONDS;
      for (const expedition of expeditions.values()) {
        if (expedition.status === "sailing") {
          expedition.elapsed += dt;
          if (expedition.departed === 0 && commanderLost(context, expedition)) cancel(expedition.id);
        } else if (prepare && expedition.status === "preparing") {
          if (commanderLost(context, expedition)) { cancel(expedition.id); continue; }
          updatePreparation(expedition);
        }
      }
    }
  };
};
