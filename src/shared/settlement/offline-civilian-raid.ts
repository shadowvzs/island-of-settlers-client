import { CIVILIAN_HP, MILITARY_PROFILES } from "../balance/military";
import { deterministicPow, DMath } from "../math/deterministic-math";
import { releaseCrew } from "./military-civilian-crews";
import { CIVILIAN_THREAT_RADIUS } from "./military-civilian-safety";
import { isAttackableCivilian } from "./military-civilian-targets";
import { fightingType } from "./military-combat-rules";
import { forgetSavedNavalPerson, type SavedNavalPeople } from "./naval-person-release";
import { withoutMovementResumeActors } from "./settlement-movement-resume";
import { releasePersonWork } from "./settlement-person-release";
import type { SettlementSaveV1 } from "./settlement-save-state";
import type { SettlementActor, SettlementContext } from "./settlement-types";
import { isSharedStorageWare } from "./shared-storage";

/**
 * Fast offline catch-up estimate of a raid on civilians (owner 2026-11-09). Exact ticks show the
 * civilians near raiders fleeing (`CIVILIAN_THREAT_RADIUS`) at walking pace, while the rest stay
 * indoors; only the ones caught before they get clear die. The estimate:
 *
 *   exposed  = player civilians outside within the threat radius of a computer field soldier
 *   capacity = Σ raiders (blow damage · 1.2^rank / blow interval) / CIVILIAN_HP   (kills per second)
 *   window   = min(modeled seconds, OFFLINE_RAID_ENGAGEMENT_SECONDS)
 *   losses   = min(exposed, floor(capacity · window · OFFLINE_RAID_CATCH_SHARE))
 *
 * The victims are the exposed civilians nearest a raider (ties by uid). Each loses its work, claims,
 * cargo and tool exactly as a civilian killed in exact ticks; its workplace hires again on recovery.
 * Crews (MIL-CREWS) are exposed too: a lost cart stays abandoned where it stood with its bed load lost
 * (MIL-TWEAKS), a led horse is let go, voyage lists forget the person and a Catapult porter's run ends,
 * as in exact ticks.
 */
/** Seconds a fleeing civilian needs to walk out of the threat radius (walking pace 0.9 tiles/s). */
export const OFFLINE_RAID_ENGAGEMENT_SECONDS = CIVILIAN_THREAT_RADIUS / .9;
/**
 * Share of the raiders' killing capacity that lands on fleeing civilians (calibrated on the exact lane:
 * 8 rank-1 foes at the developed demo's HQ: 18 exposed, 3–8 killed in exact ticks, 6 estimated).
 */
export const OFFLINE_RAID_CATCH_SHARE = .18;

interface OfflineRaid { exposed: number; losses: number; raiders: number; victims: number[] }

const raidersOf = (settlement: SettlementSaveV1, actors: ReadonlyMap<number, SettlementActor>) =>
  (settlement.military?.soldiers ?? []).flatMap(soldier => {
    const body = actors.get(soldier.actor), state = soldier.combat;
    if (!state || state.faction <= 0 || soldier.stationed || !body?.visible || body.phase !== "militaryField")
      return [];
    const type = fightingType(state), profile = MILITARY_PROFILES[type];
    return [{ body, killsPerSecond: profile.damage * deterministicPow(1.2, soldier.rank) / profile.interval /
      CIVILIAN_HP }];
  });

/** The deterministic loss estimate for `seconds` of modeled time (no change to the save). */
export const estimateOfflineRaid = (settlement: SettlementSaveV1, seconds: number): OfflineRaid => {
  const actors = new Map(settlement.actors.map(actor => [actor.uid, actor]));
  const soldierIds = new Set(settlement.military?.soldiers.map(soldier => soldier.actor) ?? []);
  const raiders = raidersOf(settlement, actors);
  if (!raiders.length || seconds <= 0) return { exposed: 0, losses: 0, raiders: raiders.length, victims: [] };
  const nearest = (actor: SettlementActor) =>
    Math.min(...raiders.map(({ body }) => DMath.hypot(body.x - actor.x, body.z - actor.z)));
  const exposed = settlement.actors.filter(actor => isAttackableCivilian(actor, uid => soldierIds.has(uid)))
    .map(actor => ({ actor, distance: nearest(actor) })).filter(entry => entry.distance <= CIVILIAN_THREAT_RADIUS)
    .sort((a, b) => a.distance - b.distance || a.actor.uid - b.actor.uid);
  const capacity = raiders.reduce((sum, raider) => sum + raider.killsPerSecond, 0);
  const window = Math.min(seconds, OFFLINE_RAID_ENGAGEMENT_SECONDS);
  const losses = Math.min(exposed.length, Math.floor(capacity * window * OFFLINE_RAID_CATCH_SHARE + 1e-9));
  return { exposed: exposed.length, losses, raiders: raiders.length,
    victims: exposed.slice(0, losses).map(entry => entry.actor.uid) };
};

type ActorEntry = { actor: number };
const withoutVictims = <Entry extends ActorEntry>(entries: Entry[] | undefined, victims: ReadonlySet<number>) =>
  entries?.filter(entry => !victims.has(entry.actor));

/** Drops every saved per-actor record of the dead (traffic, corridors, detours, surveys, builders, aliases). */
const pruneActorRecords = (settlement: SettlementSaveV1, victims: ReadonlySet<number>) => {
  const storage = settlement.storageTraffic, stock = settlement.stockTraffic;
  if (storage) Object.assign(storage, { actors: withoutVictims(storage.actors, victims)!,
    departures: withoutVictims(storage.departures, victims)!, owners: withoutVictims(storage.owners, victims)! });
  if (stock) Object.assign(stock, { actors: withoutVictims(stock.actors, victims)!,
    owners: withoutVictims(stock.owners, victims)! });
  settlement.corridorReservations = settlement.corridorReservations?.filter(([actor]) => !victims.has(actor));
  settlement.carrierDetours = withoutVictims(settlement.carrierDetours, victims);
  settlement.movementResume = withoutMovementResumeActors(settlement.movementResume, victims);
  settlement.preparedRoadActors = settlement.preparedRoadActors?.filter(uid => !victims.has(uid));
  settlement.surveys = settlement.surveys.filter(([uid]) => !victims.has(uid));
  settlement.builderSides = settlement.builderSides.filter(([uid]) => !victims.has(uid));
  const revisions = settlement.navigationRevisions;
  if (revisions?.aliases) revisions.aliases = withoutVictims(revisions.aliases, victims);
};

/** Prepaid source stock refunded into a storage's saved inventory belongs to its shared pool. */
const returnSharedRefunds = (settlement: SettlementSaveV1) => {
  for (const building of settlement.buildings) {
    const pool = settlement.storagePools.pools.find(entry => entry.id === building.storagePoolId);
    if (!pool) continue;
    for (const [ware, amount] of Object.entries(building.inventory)) {
      if (!isSharedStorageWare(ware)) continue;
      pool.available[ware] = (pool.available[ware] ?? 0) + amount;
      delete building.inventory[ware];
    }
  }
};

/** One victim: its crew first (voyage lists live in the saved naval state), then its work and claims. */
const releaseVictim = (settlement: SettlementSaveV1, context: SettlementContext, actor: SettlementActor) => {
  if (actor.navalOrder !== undefined || actor.job === "Shipwright")
    forgetSavedNavalPerson(settlement.naval as unknown as SavedNavalPeople, actor.uid);
  releaseCrew(context, actor, false);
  releasePersonWork(context, actor);
};

/**
 * Applies the estimated raid losses to a save before the fast economy models its window: the dead
 * release their claims and workplace seats, their cargo and tools are lost, and the casualty count
 * grows. Returns the estimate.
 */
export const applyOfflineCivilianRaid = (settlement: SettlementSaveV1, seconds: number) => {
  const raid = estimateOfflineRaid(settlement, seconds);
  if (!raid.losses) return raid;
  const reservations = new Set(settlement.reservations);
  // The claim and crew helpers read only these fields of the context.
  const context = { abandonedHandcarts: settlement.abandonedHandcarts, actors: settlement.actors,
    buildings: settlement.buildings, reservations } as unknown as SettlementContext;
  const victims = new Set(raid.victims);
  for (const actor of settlement.actors) if (victims.has(actor.uid)) releaseVictim(settlement, context, actor);
  if (context.abandonedHandcarts?.length) settlement.abandonedHandcarts = context.abandonedHandcarts;
  settlement.reservations = [...reservations];
  returnSharedRefunds(settlement);
  settlement.actors = settlement.actors.filter(actor => !victims.has(actor.uid));
  pruneActorRecords(settlement, victims);
  const combat = settlement.military?.combat;
  if (combat) {
    combat.civilianDeaths = (combat.civilianDeaths ?? 0) + raid.losses;
    combat.woundedCivilians = combat.woundedCivilians?.filter(entry => !victims.has(entry.actor));
    if (!combat.woundedCivilians?.length) delete combat.woundedCivilians;
  }
  if (settlement.integrity) settlement.integrity.actors = settlement.actors.length;
  return raid;
};
