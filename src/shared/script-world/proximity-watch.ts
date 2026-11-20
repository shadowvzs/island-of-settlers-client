import type { ScriptEngine } from "../../../../island-of-settlers-shared/src/script/engine/engine";
import {
  PROXIMITY_MOVING_RADIUS_MAX, PROXIMITY_STATIC_RADIUS_MAX, proximityWatchEntries, type ProximityWatchEntry,
  watchesBridgeSteps
} from "../../../../island-of-settlers-shared/src/script/engine/proximity-watch";
import {
  buildRegionCellLists, type RegionCellLists
} from "../../../../island-of-settlers-shared/src/script/engine/region-watch";
import { handleKey } from "../../../../island-of-settlers-shared/src/script/engine/values";
import type { ActorSelector } from "../../../../island-of-settlers-shared/src/script/types/actors";
import type { ScriptEmission, ScriptEventActor } from "../../../../island-of-settlers-shared/src/script/types/emission";
import type { ActorHandleValue } from "../../../../island-of-settlers-shared/src/script/types/values";
import { BRIDGE_DECK_HALF_WIDTH, type BridgeDeck, bridgeDecks, isOnDeck } from "../settlement/bridge-deck";
import { ownerOf } from "../settlement/settlement-ownership";
import type { SettlementActor, SettlementContext } from "../settlement/settlement-types";
import { cellIndexAt, forEachMissingId, isContained, NOWHERE } from "./cell-watch";
import {
  BUILDING_SIGNATURE_FIELDS, MOVING_ZONE_LIMIT, STATIC_ZONE_LIMIT, WATCH_INITIAL_CAPACITY
} from "./constants";
import { describeBuildingUid, describeUnit, findUnit, type ScriptGenerations, unitHandle } from "./script-actors";
import type { ScriptMembers } from "./script-world-members";
import { scriptSpotOf } from "./script-world-port";

/**
 * Proximity watch (trigger design §5.1.2, §5.1.3, §6.4, lane TRG4b): `cameNear` / `cameNearMoving` once per
 * approach and `bridgeStepped` once per step onto a deck. It keeps every unit's position of the previous tick's end
 * and, at the end of each live tick, compares "was inside" with "is inside":
 * - a static target (building, prop, shell) is an auto-circle in per-cell CSR lists (the TRG4 form): a unit whose
 *   cell changed enters the circles of the new cell that the old cell lacks;
 * - a moving target (a unit) is a squared-distance test against both ticks' positions of unit and target;
 * - a bridge deck is the exact deck rectangle, behind a per-cell mask of the decks' bounds.
 * Targets are resolved again every tick (bindings, actor variables, buildings of a type); the lists are rebuilt only
 * when the static set changed. Nothing is saved: every answer is a function of the two ticks' world, so a reload
 * (which re-samples the positions) continues identically. Contained units (door, deck of a ship) are nowhere, as in
 * the region watch; a circle that appears around a standing unit announces nothing.
 */

interface ProximityWatchHost {
  emit: (emission: ScriptEmission) => void;
  engine: () => ScriptEngine;
  generations: ScriptGenerations;
  /** False during offline catch-up: nothing is announced then (the watch re-samples silently afterwards). */
  live: () => boolean;
  members: ScriptMembers;
}

interface StaticZone {
  entry: ProximityWatchEntry;
  handle: ActorHandleValue;
  radius: number;
  x: number;
  z: number;
}

interface MovingZone {
  entry: ProximityWatchEntry;
  handle: ActorHandleValue;
  radiusSquared: number;
  wasPresent: boolean;
  wasX: number;
  wasZ: number;
  x: number;
  z: number;
}

const sameStaticZone = (a: StaticZone, b: StaticZone | undefined) => b !== undefined && a.entry === b.entry &&
  a.x === b.x && a.z === b.z && a.handle.id === b.handle.id && a.handle.space === b.handle.space &&
  a.handle.generation === b.handle.generation;

const isBuildingSelector = (selector: ActorSelector) => {
  if (selector.kind === "type") return selector.type.type.id.startsWith("building:");
  return selector.kind === "family" && selector.family.id.split(".")[0] === "building";
};

/**
 * Previous end-of-tick positions per unit uid (present = out in the world, not contained). The arrays are public:
 * the per-unit loop reads and writes them directly.
 */
const createPositionMemory = () => {
  const memory = {
    present: new Uint8Array(WATCH_INITIAL_CAPACITY),
    xs: new Float64Array(WATCH_INITIAL_CAPACITY),
    zs: new Float64Array(WATCH_INITIAL_CAPACITY),
    /** Room for `uid` (the arrays double; a new uid starts absent). */
    ensure: (uid: number) => {
      if (uid < memory.present.length) return;
      let size = memory.present.length;
      while (size <= uid) size *= 2;
      const present = new Uint8Array(size), xs = new Float64Array(size), zs = new Float64Array(size);
      present.set(memory.present);
      xs.set(memory.xs);
      zs.set(memory.zs);
      Object.assign(memory, { present, xs, zs });
    },
    store: (uid: number, isPresent: boolean, x: number, z: number) => {
      memory.ensure(uid);
      memory.present[uid] = isPresent ? 1 : 0;
      memory.xs[uid] = x;
      memory.zs[uid] = z;
    }
  };
  return memory;
};

type PositionMemory = ReturnType<typeof createPositionMemory>;

const zoneKey = (entry: ProximityWatchEntry, handle: ActorHandleValue) =>
  `${entry.kind}|${entry.radius}|${handleKey(handle)}`;

const staticRadius = (entry: ProximityWatchEntry) => Math.min(entry.radius, PROXIMITY_STATIC_RADIUS_MAX);

/**
 * Circles around the buildings of type/family targets. The island's buildings are compared field by field each
 * tick (no allocation) and the circles are resolved again only when a building appeared, vanished, changed owner
 * or level.
 */
const createBuildingZones = (
  context: SettlementContext, host: ProximityWatchHost, entries: readonly ProximityWatchEntry[]
) => {
  let signature = new Int32Array(0);
  let zones: StaticZone[] = [];
  let keys = new Set<string>();
  const levelOf = (index: number) => context.buildings[index]!.workshopUpgrade?.level ?? 0;
  const ownerAt = (index: number) => ownerOf(context.buildings[index]!);
  const isSigned = (index: number) => {
    const building = context.buildings[index]!, offset = index * BUILDING_SIGNATURE_FIELDS;
    return signature[offset] === building.uid && signature[offset + 1] === building.typeId &&
      signature[offset + 2] === ownerAt(index) && signature[offset + 3] === levelOf(index);
  };
  const sign = (index: number) => {
    const building = context.buildings[index]!;
    signature.set([building.uid, building.typeId, ownerAt(index), levelOf(index)], index * BUILDING_SIGNATURE_FIELDS);
  };
  const isCurrent = () => {
    if (signature.length !== context.buildings.length * BUILDING_SIGNATURE_FIELDS) return false;
    for (let index = 0; index < context.buildings.length; index++) if (!isSigned(index)) return false;
    return true;
  };
  const resolve = () => {
    signature = new Int32Array(context.buildings.length * BUILDING_SIGNATURE_FIELDS);
    for (let index = 0; index < context.buildings.length; index++) sign(index);
    zones = [];
    keys = new Set();
    for (const entry of entries) {
      for (const member of host.members.select(entry.target)) {
        const key = zoneKey(entry, member.actor.handle);
        if (keys.has(key) || zones.length >= STATIC_ZONE_LIMIT) continue;
        keys.add(key);
        zones.push({ entry, handle: member.actor.handle, radius: staticRadius(entry), x: member.x, z: member.z });
      }
    }
  };
  return {
    /** The same array while the buildings did not change. */
    current: () => {
      if (entries.length > 0 && !isCurrent()) resolve();
      return zones;
    },
    has: (key: string) => keys.has(key)
  };
};

/**
 * The live targets of the script's "came near" forms: building circles of type/family targets first (entry order),
 * then the members of authored actors and actor variables (entry order), resolved from the run state every tick.
 */
const createZoneResolver = (context: SettlementContext, host: ProximityWatchHost, memory: PositionMemory) => {
  const entries = proximityWatchEntries(host.engine().script);
  // Types and families name buildings only: every tree or soldier of a kind is not a watchable target set.
  const buildings = createBuildingZones(context, host, entries.filter(entry => isBuildingSelector(entry.target)));
  const listed = entries.filter(entry => entry.target.kind === "instance" || entry.target.kind === "variable");
  const handlesOf = (selector: ActorSelector): readonly ActorHandleValue[] => {
    const { state } = host.engine();
    if (selector.kind === "instance")
      return state.actors[selector.actor.id]?.members.map(member => member.handle) ?? [];
    if (selector.kind !== "variable") return [];
    const value = state.values[selector.variable.id];
    return value?.type === "actor" || value?.type === "actorGroup" ? value.value : [];
  };
  const movingZone = (entry: ProximityWatchEntry, handle: ActorHandleValue): MovingZone | undefined => {
    const uid = handle.id, actor = findUnit(context, uid);
    if (!actor || isContained(actor) || unitHandle(host.generations, uid).generation !== handle.generation)
      return undefined;
    const radius = Math.min(entry.radius, PROXIMITY_MOVING_RADIUS_MAX);
    memory.ensure(uid);
    return { entry, handle, radiusSquared: radius * radius, wasPresent: memory.present[uid] === 1,
      wasX: memory.xs[uid]!, wasZ: memory.zs[uid]!, x: actor.x, z: actor.z };
  };
  const staticZone = (entry: ProximityWatchEntry, handle: ActorHandleValue): StaticZone | undefined => {
    const spot = scriptSpotOf(context, host.members, handle);
    return spot && { entry, handle, radius: staticRadius(entry), x: spot.x, z: spot.z };
  };
  return {
    hasEntries: entries.length > 0,
    /** This tick's zones, each (kind, radius, target) once; animal targets are not watched. */
    resolve: () => {
      const fixed = buildings.current();
      const extra: StaticZone[] = [], movers: MovingZone[] = [], seen = new Set<string>();
      for (const entry of listed) {
        for (const handle of handlesOf(entry.target)) {
          const key = zoneKey(entry, handle);
          if (seen.has(key) || buildings.has(key) || handle.space === "animal") continue;
          seen.add(key);
          if (handle.space === "actor") {
            const zone = movers.length < MOVING_ZONE_LIMIT ? movingZone(entry, handle) : undefined;
            if (zone) movers.push(zone);
            continue;
          }
          const zone = fixed.length + extra.length < STATIC_ZONE_LIMIT ? staticZone(entry, handle) : undefined;
          if (zone) extra.push(zone);
        }
      }
      return { movers, statics: extra.length === 0 ? fixed : [...fixed, ...extra] };
    }
  };
};

/** The static circles as per-cell lists, rebuilt only when the target set changed. */
const createCircleLists = (cellsX: number, cellsZ: number) => {
  let zones: readonly StaticZone[] = [];
  let lists: RegionCellLists | undefined;
  return {
    lists: () => lists,
    use: (next: readonly StaticZone[]) => {
      if (next === zones) return;
      const unchanged = next.length === zones.length &&
        next.every((zone, index) => sameStaticZone(zone, zones[index]));
      zones = next;
      if (unchanged) return;
      lists = next.length === 0 ? undefined : buildRegionCellLists(next.map(zone => ({
        shape: { centerX: zone.x, centerZ: zone.z, kind: "circle", radius: zone.radius }
      })), cellsX, cellsZ);
    },
    zone: (index: number) => zones[index]!
  };
};

/** The island's bridge decks behind a per-cell mask of their bounds, refreshed when the road graph changed. */
const createDeckIndex = (context: SettlementContext, cellsX: number, cellsZ: number) => {
  const mask = new Uint8Array(cellsX * cellsZ);
  let decks: BridgeDeck[] = [];
  let revision: number | undefined;
  let loaded = false;
  const clampCell = (value: number, limit: number) => Math.max(0, Math.min(limit - 1, Math.floor(value)));
  const markDeck = (deck: BridgeDeck) => {
    const margin = BRIDGE_DECK_HALF_WIDTH;
    const x0 = clampCell(Math.min(deck.start.x, deck.end.x) - margin, cellsX);
    const x1 = clampCell(Math.max(deck.start.x, deck.end.x) + margin, cellsX);
    const z0 = clampCell(Math.min(deck.start.z, deck.end.z) - margin, cellsZ);
    const z1 = clampCell(Math.max(deck.start.z, deck.end.z) + margin, cellsZ);
    for (let z = z0; z <= z1; z++) mask.fill(1, z * cellsX + x0, z * cellsX + x1 + 1);
  };
  return {
    /** The deck the position stands on, or undefined. */
    deckAt: (x: number, z: number) => {
      const cell = cellIndexAt(x, z, cellsX, cellsZ);
      if (cell === NOWHERE || mask[cell] === 0) return undefined;
      return decks.find(deck => isOnDeck(deck, { x, z }));
    },
    /** Cells some deck's bounds cover (1): only units there can stand on a deck. */
    mask,
    refresh: () => {
      const { roads } = context.options;
      if (loaded && roads.revision !== undefined && roads.revision === revision) return;
      loaded = true;
      revision = roads.revision;
      decks = bridgeDecks(roads.segments?.() ?? []);
      mask.fill(0);
      decks.forEach(markDeck);
    }
  };
};

export const createProximityWatch = (context: SettlementContext, host: ProximityWatchHost) => {
  const memory = createPositionMemory();
  const resolver = createZoneResolver(context, host, memory);
  const { cellsX, cellsZ } = context.options.world;
  const deckIndex = watchesBridgeSteps(host.engine().script) ? createDeckIndex(context, cellsX, cellsZ) : undefined;
  if (!resolver.hasEntries && !deckIndex) return undefined;
  const circles = createCircleLists(cellsX, cellsZ);
  const isPresent = (actor: SettlementActor) => actor.phase !== "retired" && !isContained(actor);

  const describeTarget = (handle: ActorHandleValue) => {
    if (handle.space === "building") return describeBuildingUid(context, handle.id);
    if (handle.space !== "actor") return host.members.member(handle)?.actor;
    const actor = findUnit(context, handle.id);
    return actor && describeUnit(context, host.generations, actor);
  };
  const emitNear = (entry: ProximityWatchEntry, subject: ScriptEventActor | undefined, handle: ActorHandleValue) => {
    const target = subject && describeTarget(handle);
    if (!subject || !target) return;
    host.emit({
      actors: { subject, target }, kind: entry.kind, player: subject.owner,
      responses: { enteringActor: subject.handle, targetActor: target.handle }, values: { radius: entry.radius }
    });
  };
  const emitStep = (subject: ScriptEventActor | undefined, deck: BridgeDeck) => {
    if (!subject) return;
    host.emit({
      actors: { subject }, kind: "bridgeStepped", player: subject.owner,
      responses: { triggeringActor: subject.handle }, values: { bridgeId: deck.id }
    });
  };
  /** The unit being sampled, described at most once (only when it announces something). */
  let subject: ScriptEventActor | undefined, described = false;
  const describe = (actor: SettlementActor) => {
    if (!described) subject = describeUnit(context, host.generations, actor);
    described = true;
    return subject;
  };
  /** The circles of cell `now` that cell `before` lacks. */
  const enterCircles = (actor: SettlementActor, lists: RegionCellLists, now: number, before: number) =>
    forEachMissingId(lists, now, before, index => {
      const zone = circles.zone(index);
      emitNear(zone.entry, describe(actor), zone.handle);
    });
  /** Moving targets the unit is near now and was not near at the end of the previous tick. */
  const nearMovers = (actor: SettlementActor, wasPresent: boolean, movers: readonly MovingZone[]) => {
    const { uid, x, z } = actor, wasX = memory.xs[uid]!, wasZ = memory.zs[uid]!;
    for (const zone of movers) {
      if (zone.handle.id === uid) continue;
      const dx = x - zone.x, dz = z - zone.z;
      if (dx * dx + dz * dz > zone.radiusSquared) continue;
      const beforeX = wasX - zone.wasX, beforeZ = wasZ - zone.wasZ;
      const wasNear = wasPresent && zone.wasPresent && beforeX * beforeX + beforeZ * beforeZ <= zone.radiusSquared;
      if (!wasNear) emitNear(zone.entry, describe(actor), zone.handle);
    }
  };
  /** The deck the unit stands on now, unless it stood on the same deck at the end of the previous tick. */
  const stepOnDeck = (actor: SettlementActor, wasPresent: boolean) => {
    const deck = deckIndex!.deckAt(actor.x, actor.z);
    if (!deck) return;
    const { uid } = actor;
    if (wasPresent && deckIndex!.deckAt(memory.xs[uid]!, memory.zs[uid]!) === deck) return;
    emitStep(describe(actor), deck);
  };
  /** One present unit against this tick's circles, moving targets and decks (cheap tests first). */
  const sample = (actor: SettlementActor, movers: readonly MovingZone[], lists: RegionCellLists | undefined) => {
    const { uid } = actor;
    const wasPresent = memory.present[uid] === 1;
    const now = cellIndexAt(actor.x, actor.z, cellsX, cellsZ);
    described = false;
    if (lists) {
      const before = wasPresent ? cellIndexAt(memory.xs[uid]!, memory.zs[uid]!, cellsX, cellsZ) : NOWHERE;
      const watched = now !== NOWHERE && lists.start[now] !== lists.start[now + 1];
      if (watched && before !== now) enterCircles(actor, lists, now, before);
    }
    if (movers.length > 0) nearMovers(actor, wasPresent, movers);
    if (deckIndex && now !== NOWHERE && deckIndex.mask[now] === 1) stepOnDeck(actor, wasPresent);
  };
  /** Silent sample of every unit (map start, load, after catch-up). */
  const reset = () => {
    memory.present.fill(0);
    for (const actor of context.actors) memory.store(actor.uid, isPresent(actor), actor.x, actor.z);
  };
  /** End of a live tick: units that came inside a circle, near a moving target or onto a deck announce it. */
  const update = () => {
    if (!host.live()) return;
    const { movers, statics } = resolver.resolve();
    circles.use(statics);
    deckIndex?.refresh();
    const lists = circles.lists();
    for (const actor of context.actors) {
      const present = isPresent(actor);
      memory.ensure(actor.uid);
      if (present) sample(actor, movers, lists);
      memory.store(actor.uid, present, actor.x, actor.z);
    }
  };
  reset();
  return { reset, update };
};
