import type { ScriptEventKind } from "../../../../island-of-settlers-shared/src/script/catalog/events";
import type { ScriptEmission } from "../../../../island-of-settlers-shared/src/script/types/emission";
import { DMath } from "../math/deterministic-math";
import { getBuilding } from "../settlement/settlement-building-index";
import type { SettlementActor, SettlementContext } from "../settlement/settlement-types";
import { describeBuildingUid, describeUnit, type ScriptGenerations } from "./script-actors";
import { emitUnitAppeared } from "./script-unit-events";

/**
 * Unit appearance, door and garrison events (design §5.1.2, TRG3a). Units are created by many paths (workers,
 * recruits, immigrants, relocations) and enter or leave buildings in many door phase helpers, but all of them end
 * in a new uid or one visibility change. The watch compares each person at the end of the tick (only while one of
 * its kinds is subscribed, so other scripts pay nothing): first sight → "appeared", hidden → "entered" (or
 * "garrisoned" for a soldier at its post), shown → "left" the building it entered. The building a person is inside
 * is saved, so a reloaded island announces the same exits.
 */

const WATCH_KINDS: readonly ScriptEventKind[] = [
  "actorAppeared", "enteredBuilding", "leftBuilding", "garrisoned", "leftGarrison"
];
/** A door is at most this far (cells) from the person when it disappears through it. */
const DOOR_REACH = 3;
const GARRISON_PHASE = "garrison";

interface InsideEntry {
  building: number;
  garrison: boolean;
}

interface UnitWatchHost {
  emit: (emission: ScriptEmission) => void;
  generations: ScriptGenerations;
  isSubscribed: (kind: ScriptEventKind) => boolean;
  /** False during offline catch-up: nothing is watched then (the watch restarts silently afterwards). */
  live: () => boolean;
}

/** The building a person just went into: its post, home or delivery building nearest to it. */
const containerOf = (context: SettlementContext, actor: SettlementActor): number | undefined => {
  if (actor.navalOrder !== undefined) return undefined;
  if (actor.phase === GARRISON_PHASE) return actor.building;
  const candidates = [actor.building, actor.home, actor.delivery?.destination, actor.delivery?.source,
    actor.stockBuilding];
  let best: number | undefined, bestDistance = DOOR_REACH;
  for (const uid of candidates) {
    const building = getBuilding(context, uid);
    if (!building) continue;
    const door = building.doorThreshold;
    const distance = DMath.hypot(door.x - actor.x, door.z - actor.z);
    if (distance <= bestDistance) { best = building.uid; bestDistance = distance; }
  }
  return best;
};

export const createUnitWatch = (context: SettlementContext, host: UnitWatchHost) => {
  /** Derived: visibility at the last check (rebuilt from the actors after a load or catch-up). */
  const visible = new Map<number, boolean>();
  /** Saved: who is inside which building since the watch saw them go in. */
  const inside = new Map<number, InsideEntry>();
  /** Subscriptions are fixed per script, so this is decided once (the engine starts live). */
  const watching = WATCH_KINDS.some(kind => host.isSubscribed(kind));
  const emitDoor = (kind: ScriptEventKind, actor: SettlementActor, building: number) => {
    if (!host.isSubscribed(kind)) return;
    const subject = describeUnit(context, host.generations, actor), container = describeBuildingUid(context, building);
    if (!subject) return;
    host.emit({
      actors: container ? { building: container, subject } : { subject }, kind, player: subject.owner,
      responses: container ? { containerActor: container.handle, triggeringActor: subject.handle }
        : { triggeringActor: subject.handle }
    });
  };
  const enter = (actor: SettlementActor) => {
    const building = containerOf(context, actor);
    if (building === undefined) return;
    const garrison = actor.phase === GARRISON_PHASE;
    inside.set(actor.uid, { building, garrison });
    emitDoor(garrison ? "garrisoned" : "enteredBuilding", actor, building);
  };
  const leave = (actor: SettlementActor) => {
    const entry = inside.get(actor.uid);
    if (!entry) return;
    inside.delete(actor.uid);
    emitDoor(entry.garrison ? "leftGarrison" : "leftBuilding", actor, entry.building);
  };
  /** Silently notes a person seen for the first time: hidden means inside the building the rule finds. */
  const track = (actor: SettlementActor) => {
    visible.set(actor.uid, actor.visible);
    const building = actor.visible ? undefined : containerOf(context, actor);
    if (building !== undefined) inside.set(actor.uid, { building, garrison: actor.phase === GARRISON_PHASE });
  };
  /** Silent start (map start, after catch-up). */
  const reset = () => {
    visible.clear();
    inside.clear();
    if (!watching) return;
    for (const actor of context.actors) if (actor.phase !== "retired") track(actor);
  };
  const update = () => {
    if (!watching || !host.live()) return;
    for (const actor of context.actors) {
      if (actor.phase === "retired") continue;
      const before = visible.get(actor.uid);
      if (before === undefined) {
        emitUnitAppeared(context, actor);
        track(actor);
        continue;
      }
      if (before === actor.visible) continue;
      visible.set(actor.uid, actor.visible);
      if (actor.visible) leave(actor);
      else enter(actor);
    }
  };
  return {
    /** A person left the world: nothing to announce later. */
    forget: (uid: number) => { visible.delete(uid); inside.delete(uid); },
    reset,
    /** Loaded island: the saved inside list, visibility as the actors stand. */
    restore: (pairs: readonly number[]) => {
      reset();
      inside.clear();
      for (let index = 0; index + 2 < pairs.length; index += 3)
        inside.set(pairs[index]!, { building: pairs[index + 1]!, garrison: pairs[index + 2] === 1 });
    },
    save: () => [...inside].sort(([a], [b]) => a - b)
      .flatMap(([uid, entry]) => [uid, entry.building, entry.garrison ? 1 : 0]),
    update
  };
};

export type UnitWatch = ReturnType<typeof createUnitWatch>;
