import { entriesOfKind } from "@shared/catalog";

import { getMeshKind, getMeshVariant } from "../../render-common/props/prop-mesh-layout";
import { hasPearl } from "../../render-common/props/shells/open-shells";
import { isShoreRespawnSite, listShoreShellSpots } from "../../render-common/props/shore-shell-spots";
import type { WorldData } from "../world/world-data";

/**
 * Home-island shore shell collecting (prep for quests): a collected shell disappears and the same
 * shell (kind, variant, pearl or not) reappears on another part of the beach, far from where it
 * was picked. Deterministic for replay: the new place is chosen by an integer hash of the island
 * seed and the collect count among the dry beach sites (no random stream is drawn).
 */

/** Shell kind names reported to quests. */
export type ShoreShellKind = "seashell" | "openShell" | "seaStar" | "seaSnailShell" | "snailShell";

/** Domain event: a player collected a shore shell (quests count these later). */
export interface ShoreShellCollected {
  index: number;
  kind: ShoreShellKind;
  pearl: boolean;
  type: "shoreShellCollected";
  variant: number;
}

/** Saved state: reappeared shells (flat [index, x, z, ...], as world.shoreShellMoves) and the count. */
export interface ShoreShellLedger {
  collected: number;
  moves: number[];
}

/** A respawn lies at least this share of the island span away from the picked shell. */
export const SHORE_RESPAWN_MIN_SHARE = 0.25;
/** A respawn keeps this distance (cells) from every other shell. */
const RESPAWN_SPACING = 0.5;

/** Shell kind names by prop byte: the catalog's `shell:*` keys (persisted in quest progress). */
const KIND_NAMES: Partial<Record<number, ShoreShellKind>> = Object.fromEntries(entriesOfKind("shell")
  .map(entry => [entry.code, entry.key as ShoreShellKind]));
const OPEN_SHELL = entriesOfKind("shell").find(entry => entry.key === "openShell")!.code;

export const createShoreShellLedger = (): ShoreShellLedger => ({ collected: 0, moves: [] });

/** Current position of every shell (moves applied). */
export const getShoreShellPositions = (world: WorldData, ledger: ShoreShellLedger) => {
  const positions = listShoreShellSpots(world).map(({ x, z }) => ({ x, z }));
  for (let at = 0; at + 2 < ledger.moves.length; at += 3)
    positions[ledger.moves[at]!] = { x: ledger.moves[at + 1]!, z: ledger.moves[at + 2]! };
  return positions;
};

/** 32-bit integer hash (deterministic on every engine). */
const hashInt = (seed: number, value: number) => {
  let hash = (seed ^ Math.imul(value + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
};

const isWithinRespawnSpacing = (other: { x: number; z: number }, x: number, z: number) => {
  const dx = other.x - x;
  const dz = other.z - z;
  return dx * dx + dz * dz < RESPAWN_SPACING * RESPAWN_SPACING;
};

/** Dry beach cell centres far from `from` and clear of every other shell. */
const listRespawnSites = (world: WorldData, from: { x: number; z: number }, others: { x: number; z: number }[]) => {
  const minimum = SHORE_RESPAWN_MIN_SHARE * Math.max(world.cellsX, world.cellsZ);
  const sites: { x: number; z: number }[] = [];
  for (let cellZ = 0; cellZ < world.cellsZ; cellZ += 1) {
    for (let cellX = 0; cellX < world.cellsX; cellX += 1) {
      const x = cellX + 0.5, z = cellZ + 0.5;
      const dx = x - from.x, dz = z - from.z;
      if (dx * dx + dz * dz < minimum * minimum || !isShoreRespawnSite(world, x, z)) continue;
      if (others.some((other) => isWithinRespawnSpacing(other, x, z))) continue;
      sites.push({ x, z });
    }
  }
  return sites;
};

const replaceMove = (moves: number[], index: number, x: number, z: number) => {
  const kept: number[] = [];
  for (let at = 0; at + 2 < moves.length; at += 3)
    if (moves[at] !== index) kept.push(moves[at]!, moves[at + 1]!, moves[at + 2]!);
  return [...kept, index, x, z];
};

/**
 * Collects shell `index`: picks its far respawn site, records it in the ledger and on the world
 * (the renderer reads world.shoreShellMoves) and returns the event; null for an unknown shell or
 * when the island has no free far beach site (the shell then stays).
 */
export const collectShoreShell = (world: WorldData, ledger: ShoreShellLedger, index: number) => {
  const spots = listShoreShellSpots(world);
  const spot = Number.isInteger(index) ? spots[index] : undefined;
  if (!spot) return null;
  const positions = getShoreShellPositions(world, ledger);
  const sites = listRespawnSites(world, positions[index]!, positions.filter((_, other) => other !== index));
  if (!sites.length) return null;
  const site = sites[hashInt(world.seed, ledger.collected) % sites.length]!;
  ledger.collected += 1;
  ledger.moves = replaceMove(ledger.moves, index, site.x, site.z);
  world.shoreShellMoves = [...ledger.moves];
  const kind = getMeshKind(spot.meshId), variant = getMeshVariant(spot.meshId);
  const event: ShoreShellCollected = {
    index, kind: KIND_NAMES[kind]!, pearl: kind === OPEN_SHELL && hasPearl(variant),
    type: "shoreShellCollected", variant
  };
  return { event, from: positions[index]!, to: site };
};

/** Restores a saved ledger (validated) and mirrors its moves onto the world. */
export const restoreShoreShellLedger = (world: WorldData, saved: ShoreShellLedger | undefined) => {
  const ledger = saved && isValidShoreShellLedger(saved, listShoreShellSpots(world).length)
    ? { collected: saved.collected, moves: [...saved.moves] } : createShoreShellLedger();
  world.shoreShellMoves = [...ledger.moves];
  return ledger;
};

export const isValidShoreShellLedger = (value: unknown, shellCount: number): value is ShoreShellLedger => {
  if (!value || typeof value !== "object") return false;
  const { collected, moves } = value as ShoreShellLedger;
  if (!Number.isInteger(collected) || collected < 0 || !Array.isArray(moves) || moves.length % 3 !== 0) return false;
  for (let at = 0; at < moves.length; at += 3) {
    const index = moves[at]!;
    if (!Number.isInteger(index) || index < 0 || index >= shellCount) return false;
    if (!Number.isFinite(moves[at + 1]) || !Number.isFinite(moves[at + 2])) return false;
  }
  return true;
};
