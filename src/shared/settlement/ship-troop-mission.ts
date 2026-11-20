import { SHIP_TROOP_MISSION_VERSION } from "./constants";
import { type AdventureLanding, adventureLandingError } from "./settlement-adventure-landing";
import type { ShipDestination } from "./settlement-ship-routes";
import { type AnchorGlide, anchorGlideError } from "./ship-troop-anchor-glide";

/**
 * Where a troop ship goes once its boarding is complete (MIL-SHIPS-SIM, owner 2026-11-13): an own harbour
 * (`unload`: the troops walk ashore into it, else they stay aboard at the pier) or a coast anchorage
 * (`land`: the troops walk down the gangway, else the ship lies there with its gangway out).
 */
export type ShipTroopTarget =
  | { kind: "harbour"; uid: number; unload: boolean }
  | { kind: "coast"; land: boolean; landing: AdventureLanding };

/**
 * A player-controlled troop voyage of one own ship (`embarkMilitary`, `sailShip`, `landShipTroops`). The ship
 * is out of the order-driven fleet while it holds one. Soldiers aboard (or walking aboard) are the ship's
 * ordinary `passengers`; this record keeps the rest.
 */
export interface ShipTroopMission {
  version: typeof SHIP_TROOP_MISSION_VERSION;
  /** Soldiers ordered aboard that are not passengers yet: walking to the harbour or the gangway foot. */
  boarding: number[];
  /** The harbour whose pier the ship lies at or is bound for. */
  harbourUid?: number;
  /** Loaded and clear of the berth: the harbour whose waiting spot (`NavalShip.anchorage`) the ship lies at. */
  waitingOff?: number;
  /** The coast anchorage the ship lies at, gangway out (its `ashore` counts the soldiers landed). */
  anchor?: AdventureLanding;
  target?: ShipTroopTarget;
  /** Soldiers walking off the anchored ship, until they are clear of the gangway foot. */
  landers?: number[];
  /** Foot soldiers and riders already landed from the current anchorage (deck places and gathering slots). */
  landedFoot?: number;
  landedRiders?: number;
  /** Easing onto the coast target's anchorage pose from where the helm stopped (2026-11-17). */
  glide?: AnchorGlide;
  /** Seconds the empty anchored ship still waits for soldiers to board before it rejoins the fleet. */
  linger?: number;
}

/** The ship that holds a mission, as the shared helpers read it. */
export interface TroopMissionShip { troopMission?: ShipTroopMission }

const isIdList = (value: unknown, isSoldier: (uid: number) => boolean) => Array.isArray(value) &&
  new Set(value).size === value.length && value.every(uid => Number.isSafeInteger(uid) && isSoldier(uid));

const isCount = (value: unknown) => value === undefined || (Number.isSafeInteger(value) && (value as number) >= 0);

const targetError = (target: ShipTroopTarget | undefined, isHarbour: (uid: number) => boolean) => {
  if (target === undefined) return false;
  if (!target || typeof target !== "object") return true;
  if (target.kind === "harbour") return !isHarbour(target.uid) || typeof target.unload !== "boolean";
  return target.kind !== "coast" || typeof target.land !== "boolean" || target.landing === undefined ||
    adventureLandingError(target.landing);
};

/** Why a saved mission is malformed (null when it is valid); soldier and harbour identities come from the save. */
export const shipTroopMissionError = (mission: ShipTroopMission | undefined,
  isSoldier: (uid: number) => boolean, isHarbour: (uid: number) => boolean): string | null => {
  if (mission === undefined) return null;
  if (!mission || typeof mission !== "object" || mission.version !== SHIP_TROOP_MISSION_VERSION)
    return "Invalid troop ship mission";
  if (!isIdList(mission.boarding, isSoldier) ||
    (mission.landers !== undefined && !isIdList(mission.landers, isSoldier)))
    return "Invalid troop ship soldiers";
  const berths = [mission.harbourUid, mission.waitingOff, mission.anchor].filter(entry => entry !== undefined);
  if ((mission.harbourUid !== undefined && !isHarbour(mission.harbourUid)) ||
    (mission.waitingOff !== undefined && !isHarbour(mission.waitingOff)) || berths.length > 1 ||
    (mission.anchor !== undefined && adventureLandingError(mission.anchor)) ||
    targetError(mission.target, isHarbour))
    return "Invalid troop ship berth or target";
  if (!isCount(mission.landedFoot) || !isCount(mission.landedRiders) ||
    (mission.linger !== undefined && !(Number.isFinite(mission.linger) && mission.linger >= 0)) ||
    anchorGlideError(mission.glide) || (mission.glide !== undefined && mission.target?.kind !== "coast"))
    return "Invalid troop ship landing state";
  return null;
};

/** A coast-bound troop ship's anchorage (the helm's and restore's route endpoint); undefined otherwise. */
export const troopMissionWater = (ship: TroopMissionShip): ShipDestination | undefined => {
  const target = ship.troopMission?.target;
  return target?.kind === "coast" ? { ...target.landing.water, yaw: target.landing.yaw } : undefined;
};
