import type { ShipDeckTroop, ShipFrame, ShipSiteFrame } from "../../render-common/ships/ship-frame";
import type { MilitaryCombatant } from "../../shared/settlement/military-combat-rules";
import { DOCK_ID_OFFSET } from "../../shared/settlement/settlement-harbour-docks";
import type { TransportHorseFrame } from "../../shared/settlement/settlement-horses";
import type { SettlementActor, SettlementPoint } from "../../shared/settlement/settlement-types";
import { TROOP_LANDING_SPEED } from "../../shared/settlement/ship-cargo-handling";
import { planTroopShipLanding, type Spot } from "../../shared/settlement/troop-ship-landing";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";

/** Phase of the drawn soldiers standing on a deck: posed exactly, never smoothed as walkers. */
export const DECK_TROOP_ACTOR_PHASE = "deckTroop";
/** Stand-in ids, far above any real actor id (one block of deck places per ship); their horses' above. */
const STAND_IN_BASE = 1_500_000_000, STAND_INS_PER_SHIP = 64, HORSE_STAND_IN_BASE = 1_600_000_000;
const TOOLS = { archer: "bow", cavalry: "sword", heavy: "axe", shield: "sword" } as const;

interface DeckTroopSoldier { actor: number; combat: MilitaryCombatant; rank: number }
export interface DeckTroopsView {
  actors: SettlementActor[];
  /** Riders' horses standing on deck, held by their riders. */
  horses: TransportHorseFrame[];
  soldiers: DeckTroopSoldier[];
}
/** Where a soldier `walked` tiles along `points` stands; null once he is through the harbour door. */
const walkedTo = (world: WorldData, points: readonly SettlementPoint[], walked: number, start: Spot,
  dock: ShipSiteFrame): Spot | null => {
  const rampLeg = points.findIndex(point => point === dock.workPier!.shore);
  let left = walked;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!, to = points[index]!, length = Math.hypot(to.x - from.x, to.z - from.z);
    if (left > length) { left -= length; continue; }
    const share = length ? left / length : 1;
    const x = from.x + (to.x - from.x) * share, z = from.z + (to.z - from.z) * share;
    const y = heightOnWay(world, index - rampLeg + 3, share, { x, z }, start, dock);
    return { x, y, yaw: Math.atan2(to.x - from.x, to.z - from.z), z };
  }
  return null;
};
/** On deck and gangway at deck height (legs 1 and 2), down the pier's ramp (leg 3), then on the ground. */
const heightOnWay = (world: WorldData, leg: number, share: number, point: SettlementPoint, start: Spot,
  dock: ShipSiteFrame) => {
  const pier = dock.workPier!;
  if (leg <= 2) return start.y;
  if (leg === 3) return pier.y + (pier.shoreY - pier.y) * share;
  return sampleSmooth(world, world.heights, point.x, point.z);
};

/** One stand-in soldier (`index` aboard): a man on foot or a rider on horseback, standing or walking. */
const standIn = (uid: number, index: number, troop: ShipDeckTroop, spot: Spot, walked: number, mounted: boolean) =>
  ({ action: walked > 0 ? "walk" : "idle", animationTime: walked > 0 ? walked : index * .37, building: -3,
    home: -3, job: "Soldier", mounted, path: [], pathIndex: 0, phase: DECK_TROOP_ACTOR_PHASE, timer: 0,
    tool: TOOLS[troop.type], uid, visible: true, ware: null, x: spot.x, y: spot.y, yaw: spot.yaw,
    z: spot.z }) as SettlementActor;

const heldHorse = (id: number, leader: number, horse: Spot): TransportHorseFrame =>
  ({ heading: horse.yaw, held: true, id, leader, moving: false, visible: true, x: horse.x, y: horse.y,
    z: horse.z });

/**
 * Soldiers from another island aboard a ship, drawn standing on its deck for the whole voyage and
 * walking ashore over the pier, one after another, while the ship unloads at the harbour. Riders'
 * horses stand on deck when there is room (owner, 2026-10-15), held by their riders, who land last:
 * mounted, down the gangway and over the pier into the harbour.
 */
export const deckTroopsView = (world: WorldData, ships: readonly ShipFrame[], sites: readonly ShipSiteFrame[],
  extraSeconds = 0): DeckTroopsView => {
  const view: DeckTroopsView = { actors: [], horses: [], soldiers: [] };
  for (const ship of ships) {
    if (!ship.deckTroops?.length) continue;
    const dock = ship.cargoWork?.unloading ? sites.find(site => site.id === DOCK_ID_OFFSET + ship.id) : undefined;
    const ashore = dock?.workPier && dock.porterRoute ? dock : undefined;
    const plan = planTroopShipLanding(ship, ashore as Parameters<typeof planTroopShipLanding>[1]);
    const { aboard, troops } = plan;
    troops.forEach((troop, index) => {
      const at = aboard[index];
      if (!at) return;
      const uid = STAND_IN_BASE + ship.id * STAND_INS_PER_SHIP + index, rider = troop.type === "cavalry";
      const walked = ashore ? (ship.cargoWork!.elapsed + extraSeconds - plan.starts[index]!) * TROOP_LANDING_SPEED : -1;
      // A rider whose horse waits below deck is not seen until he comes up at his turn.
      if (walked <= 0 && !at.horse && !at.slot) return;
      const spot = walked > 0 ? walkedTo(world, plan.paths[index]!, walked, at.start, ashore!) : at.place;
      if (!spot) return;
      view.actors.push(standIn(uid, index, troop, spot, walked, rider && walked > 0));
      const horseId = HORSE_STAND_IN_BASE + ship.id * STAND_INS_PER_SHIP + index;
      if (walked <= 0 && at.horse) view.horses.push(heldHorse(horseId, uid, at.horse));
      view.soldiers.push({ actor: uid, combat: { cooldown: 0, faction: 0, hp: 1, type: troop.type },
        rank: troop.rank });
    });
  }
  return view;
};
