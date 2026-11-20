import { type DiscoveryBits, markDiscoveredRow } from "./faction-discovery";
import {
  actorSight, buildingSight, shipSight, type VisionSight, type VisionSightSources
} from "./faction-vision-sight";
import { PLAYER_FACTION, type PlayerSightSink } from "./player-fog";
import type { NavalShip } from "./settlement-naval-fleet";
import type { SettlementActor, SettlementBuilding } from "./settlement-types";

/**
 * Faction perception (A13, owner decision D-AI1): one observer counter per map cell and faction (0 the
 * player, 1.. computer factions and bandits). Each tick the canonical simulation positions are compared
 * with the last stamped cell of every observer; only an observer that changed cell, faction or radius
 * is stamped again, so a standing army costs a map lookup per unit. Integer disks (dx² + dz² <= r²)
 * round the observer's cell make the layer depend on cells alone: identical for every frame rate,
 * camera and quality preset.
 *
 * Phase 2: the player's counter crossings (0 → 1, 1 → 0) drive the fog of war through the player fog's
 * sink (player-fog.ts). The counters are not saved: a load rebuilds them from positions.
 *
 * A14-4b: every disk a computer observer stamps or takes away is queued as a sight change (faction, cell,
 * radius, kind) until the strategic knowledge drains it at the end of the tick: the known-sites ledger and the
 * sector staleness update only around those disks, never by scanning the map.
 */
export interface FactionVisionSources extends VisionSightSources {
  actors: readonly SettlementActor[];
  buildings: readonly SettlementBuilding[];
  naval?: { explorerShips?: () => readonly NavalShip[] };
}

/** A disk a computer observer took away (the cells it saw until now). */
export const SIGHT_LEAVE = 0;
/** A disk a computer observer stamped this tick. */
export const SIGHT_ENTER = 1;
/** Visits one queued sight change; `radius` in tiles, `cell` = row · cellsX + column. */
export type SightChangeVisitor = (faction: number, cell: number, radius: number, kind: number) => void;
/** Queued changes (4 numbers each) kept at most; beyond it the queue reports an overflow instead. */
const MAX_SIGHT_CHANGES = 16_384;

interface VisionObserver {
  cell: number;
  faction: number;
  generation: number;
  radius: number;
}

/** Row half-widths of the integer disk of `radius`, indexed by `dz + reach` (every row has its centre). */
const diskRows = (radius: number) => {
  const reach = Math.floor(radius), limit = radius * radius;
  const rows = new Int16Array(2 * reach + 1);
  for (let dz = -reach; dz <= reach; dz++) {
    let width = reach;
    while (width > 0 && width * width + dz * dz > limit) width--;
    rows[dz + reach] = width;
  }
  return rows;
};

/** Adds `delta` to the cells `first..last` and reports the player's 0 ↔ 1 crossings to `sink`. */
const stampPlayerRow = (layer: Uint16Array, first: number, last: number, delta: number, sink: PlayerSightSink) => {
  for (let cell = first; cell <= last; cell++) {
    const count = layer[cell]! + delta;
    layer[cell] = count;
    if (delta > 0 && count === 1) sink.seen(cell);
    else if (delta < 0 && count === 0) sink.unseen(cell);
  }
};

// The observer bookkeeping shares one closure so the per-tick pass stays allocation free.
// oxlint-disable-next-line max-lines-per-function
export const createFactionVision = (cellsX: number, cellsZ: number, playerSink?: PlayerSightSink) => {
  const layers = new Map<number, Uint16Array>();
  /** Computer factions whose discovered cells are tracked (`develop` AI, plan §3.2): stamped with their disks. */
  const discoveries = new Map<number, DiscoveryBits>();
  const disks = new Map<number, Int16Array>();
  const actorObservers = new Map<number, VisionObserver>();
  const buildingObservers = new Map<number, VisionObserver>();
  const shipObservers = new Map<number, VisionObserver>();
  /** Buildings with a soldier inside this pass: an empty garrison building is blind. */
  const garrisoned = new Set<number>();
  const sight: VisionSight = { faction: 0, radius: 0 };
  const previous: VisionObserver = { cell: 0, faction: 0, generation: 0, radius: 0 };
  let generation = 0, restamps = 0, rebuilding = false, overflowed = false;
  /** Pending computer sight changes, flat [faction, cell, radius, kind] (reused, drained every tick). */
  const changes: number[] = [];
  /** A rebuild (a load or a fresh island) queues nothing: it restamps known positions, nothing changed sight. */
  const queueChange = (observer: VisionObserver, kind: number) => {
    if (observer.faction === PLAYER_FACTION || overflowed || rebuilding) return;
    if (changes.length >= MAX_SIGHT_CHANGES * 4) { overflowed = true; changes.length = 0; return; }
    changes.push(observer.faction, observer.cell, observer.radius, kind);
  };

  const layerOf = (faction: number) => {
    let layer = layers.get(faction);
    if (!layer) { layer = new Uint16Array(cellsX * cellsZ); layers.set(faction, layer); }
    return layer;
  };
  const diskOf = (radius: number) => {
    let rows = disks.get(radius);
    if (!rows) { rows = diskRows(radius); disks.set(radius, rows); }
    return rows;
  };
  const cellOf = (x: number, z: number) => {
    const column = Math.min(cellsX - 1, Math.max(0, Math.floor(x)));
    const row = Math.min(cellsZ - 1, Math.max(0, Math.floor(z)));
    return row * cellsX + column;
  };
  /** Adds `delta` (+1 / -1) to every cell of the observer's disk, clipped to the map. */
  const stamp = (observer: VisionObserver, delta: number) => {
    const layer = layerOf(observer.faction), rows = diskOf(observer.radius);
    const sink = observer.faction === PLAYER_FACTION ? playerSink : undefined;
    const discovery = delta > 0 ? discoveries.get(observer.faction) : undefined;
    const reach = (rows.length - 1) >> 1, column = observer.cell % cellsX;
    const row = (observer.cell - column) / cellsX;
    const firstRow = Math.max(0, row - reach), lastRow = Math.min(cellsZ - 1, row + reach);
    for (let z = firstRow; z <= lastRow; z++) {
      const width = rows[z - row + reach]!;
      const rowStart = z * cellsX;
      const first = rowStart + Math.max(0, column - width), last = rowStart + Math.min(cellsX - 1, column + width);
      if (sink) { stampPlayerRow(layer, first, last, delta, sink); continue; }
      for (let cell = first; cell <= last; cell++) layer[cell]! += delta;
      if (discovery) markDiscoveredRow(discovery, first, last);
    }
  };
  const observe = (observers: Map<number, VisionObserver>, key: number, cell: number) => {
    const observer = observers.get(key);
    if (!observer) {
      const created = { cell, faction: sight.faction, generation, radius: sight.radius };
      observers.set(key, created);
      stamp(created, 1); restamps++;
      queueChange(created, SIGHT_ENTER);
      return;
    }
    observer.generation = generation;
    if (observer.cell === cell && observer.faction === sight.faction && observer.radius === sight.radius) return;
    // The new disk first: a cell both disks cover never drops to 0 (the fog never flickers there).
    previous.cell = observer.cell; previous.faction = observer.faction; previous.radius = observer.radius;
    observer.cell = cell; observer.faction = sight.faction; observer.radius = sight.radius;
    stamp(observer, 1);
    stamp(previous, -1); restamps++;
    queueChange(observer, SIGHT_ENTER);
    queueChange(previous, SIGHT_LEAVE);
  };
  /** Observers not seen this pass (dead, removed, gone inside or aboard) take their sight away. */
  const sweep = (observers: Map<number, VisionObserver>) => {
    for (const [key, observer] of observers) {
      if (observer.generation === generation) continue;
      stamp(observer, -1); observers.delete(key);
      queueChange(observer, SIGHT_LEAVE);
    }
  };
  const observeActors = (sources: FactionVisionSources) => {
    garrisoned.clear();
    for (const actor of sources.actors) {
      if (actor.job === "Soldier" && actor.phase === "garrison") garrisoned.add(actor.building);
      if (actorSight(sources, actor, sight)) observe(actorObservers, actor.uid, cellOf(actor.x, actor.z));
    }
  };
  const observeShips = (sources: FactionVisionSources) => {
    const ships = sources.naval?.explorerShips?.();
    if (!ships) return;
    for (const ship of ships) if (shipSight(ship, sight)) observe(shipObservers, ship.id, cellOf(ship.x, ship.z));
  };
  const update = (sources: FactionVisionSources) => {
    generation++;
    observeActors(sources);
    for (const building of sources.buildings)
      if (buildingSight(building, garrisoned.has(building.uid), sight))
        observe(buildingObservers, building.uid, cellOf(building.x, building.z));
    observeShips(sources);
    sweep(actorObservers);
    sweep(buildingObservers);
    sweep(shipObservers);
  };
  /** Clears every counter without crossings: only `rebuild` (followed by the fog's normalization) uses it. */
  const reset = () => {
    for (const layer of layers.values()) layer.fill(0);
    actorObservers.clear();
    buildingObservers.clear();
    shipObservers.clear();
    changes.length = 0;
    overflowed = false;
  };
  /**
   * Hands every queued computer sight change to `visit` in queue order and empties the queue; false when the
   * queue overflowed since the last drain (the reader then rescans what it needs once).
   */
  const drainSightChanges = (visit: SightChangeVisitor) => {
    const complete = !overflowed;
    for (let index = 0; index < changes.length; index += 4)
      visit(changes[index]!, changes[index + 1]!, changes[index + 2]!, changes[index + 3]!);
    changes.length = 0;
    overflowed = false;
    return complete;
  };
  /** Observers of `faction` seeing the cell under the point (0: unseen; off-map points are unseen). */
  const observersAt = (faction: number, x: number, z: number) => {
    if (!(x >= 0 && z >= 0 && x < cellsX && z < cellsZ)) return 0;
    return layers.get(faction)?.[cellOf(x, z)] ?? 0;
  };
  return {
    cellsX,
    cellsZ,
    drainSightChanges,
    /** Factions that ever had an observer, ascending (their layers may be all zero now). */
    factions: () => [...layers.keys()].sort((a, b) => a - b),
    /** Read-only view of a faction's counters (undefined: never observed). */
    layer: (faction: number): Readonly<Uint16Array> | undefined => layers.get(faction),
    observersAt,
    /** A load replaces every actor: clear, then stamp the restored positions at once. */
    rebuild: (sources: FactionVisionSources) => {
      reset();
      rebuilding = true;
      update(sources);
      rebuilding = false;
    },
    sees: (faction: number, x: number, z: number) => observersAt(faction, x, z) > 0,
    /**
     * Stamps `faction`'s discovered cells into `bits` with each disk it stamps from now on (undefined: stops). The
     * bits belong to the caller (the faction AI saves them); a caller that starts mid-game also marks the cells the
     * faction sees now (`markSeenCells`).
     */
    trackDiscovery: (faction: number, bits: DiscoveryBits | undefined) => {
      if (bits) discoveries.set(faction, bits); else discoveries.delete(faction);
    },
    stats: () => ({ actorObservers: actorObservers.size, buildingObservers: buildingObservers.size,
      restamps, shipObservers: shipObservers.size }),
    update
  };
};

export type FactionVision = ReturnType<typeof createFactionVision>;
