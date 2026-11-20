import { MILITARY_PROFILES } from "../balance/military";
import { DMath } from "../math/deterministic-math";
import { fightingType, type MilitaryCombatant } from "./military-combat-rules";
import { militaryContactReach } from "./military-contact";
import {
  type EngagementClaim, holdsPlace, MELEE_PLACES, placeHeading, pointAround, RIDER_PLACES, RING_GAP, staggerShare
} from "./military-engagement";
import { restoreEntries, saveEntries, type SavedEntries } from "./military-field-save";
import type { SettlementSoldier } from "./settlement-military";
import { isMountedNavigationClear, isNavigationClear } from "./settlement-navigation";
import { actorSeparation } from "./settlement-traffic";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * Melee engagement places round each foe (docs/archive/dated/military-motion-2026-10-13.md, step 3; rules in
 * `military-engagement.ts`). Claims are rebuilt from the soldiers' targets every tick; claims, places
 * and the foe of each soldier's first blow are saved, so a loaded battle keeps every place.
 */
interface Place { foe: number; heading: number }
export interface MilitaryMeleeSave {
  claimants: SavedEntries<EngagementClaim[]>; firstBlows: SavedEntries<number>; places: SavedEntries<Place>;
}
export interface MeleeApproach {
  /** Where to go: the soldier's place at the foe, or its spot in the waiting ring. */
  point: SettlementPoint;
  /** It holds one of the foe's places (else it waits in the ring). */
  admitted: boolean;
  /** Distance from the foe it fights at. */
  standoff: number;
}

export const createMilitaryMelee = (context: SettlementContext, soldiers: ReadonlyMap<number, SettlementSoldier>,
  actorById: (id: number) => SettlementActor | undefined) => {
  const claimants = new Map<number, EngagementClaim[]>();
  const places = new Map<number, Place>();
  const firstBlows = new Map<number, number>();

  /** Melee soldiers in the field going for each foe this tick, with their distance to it. */
  const rebuild = (bodies: readonly SettlementActor[]) => {
    claimants.clear();
    for (const body of bodies) {
      const state = soldiers.get(body.uid)?.combat, foe = state?.target;
      if (!state || fightingType(state) === "archer" || foe === undefined || body.phase !== "militaryField") continue;
      const enemy = actorById(foe);
      if (!enemy) continue;
      let list = claimants.get(foe);
      if (!list) { list = []; claimants.set(foe, list); }
      list.push({ distance: DMath.hypot(enemy.x - body.x, enemy.z - body.z), holding: places.get(body.uid)?.foe === foe,
        uid: body.uid });
    }
  };
  /** Distance from `enemy` at `heading` where the attacker strikes it (a horse is long: its sides are nearer). */
  const standoffAt = (actor: SettlementActor, state: MilitaryCombatant, enemy: SettlementActor, heading: number) => {
    const type = fightingType(state), range = MILITARY_PROFILES[type].range;
    const defender = soldiers.get(enemy.uid)?.combat?.type ?? "shield";
    const reach = militaryContactReach(type, range,
      { mounted: actor.mounted, x: enemy.x + DMath.cos(heading), z: enemy.z + DMath.sin(heading) },
      defender, enemy);
    const radius = Math.max(range * .85, Math.min(reach * .85, reach - .01), actorSeparation(actor, enemy) + .04);
    return radius > reach ? null : radius;
  };
  /** Headings of the places other attackers already hold at `foe`. */
  const takenHeadings = (foe: number, uid: number) => {
    const taken: number[] = [];
    for (const claim of claimants.get(foe) ?? []) {
      const place = places.get(claim.uid);
      if (claim.uid !== uid && place?.foe === foe) taken.push(place.heading);
    }
    return taken;
  };
  const takePlace = (actor: SettlementActor, state: MilitaryCombatant, enemy: SettlementActor) => {
    const held = places.get(actor.uid);
    if (held?.foe === enemy.uid) return held;
    const bearing = DMath.atan2(actor.z - enemy.z, actor.x - enemy.x);
    const open = (heading: number) => {
      const radius = standoffAt(actor, state, enemy, heading);
      if (radius === null) return false;
      const point = pointAround(enemy, heading, radius);
      return isNavigationClear(context, point) && (!actor.mounted || isMountedNavigationClear(context, point));
    };
    const place = { foe: enemy.uid, heading: placeHeading(bearing, takenHeadings(enemy.uid, actor.uid), open) ?? bearing };
    places.set(actor.uid, place);
    return place;
  };
  /**
   * Where a melee soldier closes in on `enemy`: its place when it holds one (the nearest claimants do;
   * a soldier the foe is fighting always does), otherwise its spot in the waiting ring.
   */
  const approach = (actor: SettlementActor, state: MilitaryCombatant, enemy: SettlementActor): MeleeApproach => {
    const fightsMe = soldiers.get(enemy.uid)?.combat?.target === actor.uid;
    const count = enemy.mounted ? RIDER_PLACES : MELEE_PLACES;
    const admitted = fightsMe || holdsPlace(claimants.get(enemy.uid) ?? [], actor.uid, count);
    const range = MILITARY_PROFILES[fightingType(state)].range;
    if (!admitted) {
      places.delete(actor.uid);
      const bearing = DMath.atan2(actor.z - enemy.z, actor.x - enemy.x);
      const ring = range + RING_GAP + (actor.mounted || enemy.mounted ? 1 : 0);
      return { admitted, point: pointAround(enemy, bearing, ring), standoff: ring };
    }
    const { heading } = takePlace(actor, state, enemy);
    const standoff = standoffAt(actor, state, enemy, heading) ?? range * .85;
    return { admitted, point: pointAround(enemy, heading, standoff), standoff };
  };
  /**
   * Extra wait before the first blow at a new foe while comrades fight close by (`crowded`), so
   * neighbours do not swing in lockstep; a lone duellist strikes at once (0 after the first blow).
   */
  const firstBlowDelay = (uid: number, foe: number, interval: number, crowded: boolean) => {
    if (firstBlows.get(uid) === foe) return 0;
    firstBlows.set(uid, foe);
    return crowded ? interval * staggerShare(uid, foe) : 0;
  };
  return {
    approach, firstBlowDelay, rebuild,
    /** Melee soldiers going for `foe` (last tick's decisions). */
    claimCount: (foe: number) => claimants.get(foe)?.length ?? 0,
    forget: (uid: number) => { places.delete(uid); firstBlows.delete(uid); },
    clear: () => { claimants.clear(); places.clear(); firstBlows.clear(); },
    save: (): MilitaryMeleeSave =>
      ({ claimants: saveEntries(claimants), firstBlows: saveEntries(firstBlows), places: saveEntries(places) }),
    restore: (saved: Partial<MilitaryMeleeSave> | undefined) => {
      restoreEntries(claimants, saved?.claimants);
      restoreEntries(places, saved?.places);
      restoreEntries(firstBlows, saved?.firstBlows);
    }
  };
};
