import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { nationOf } from "../../shared/settlement/settlement-nation";
import { computerEconomies, PLAYER_FACTION } from "../../shared/settlement/settlement-ownership";
import type { Goods } from "../../shared/settlement/settlement-types";
import type { WorldData } from "../../shared/world/world-data";
import { OFFLINE_FLAX_FARM_TYPE, OFFLINE_OWNER_WARE_TAG } from "./constants";
import type { EconomyGoods, OfflineEconomyJob } from "./offline-economy-events";
import { estimateOfflineEconomyRates, type OfflineEconomyRates } from "./offline-economy-rates";

/**
 * Per-owner pools of the fast offline economy (enemy economy AI plan §5.3, EAI1a F1/F2/F6; EAI5b). A computer
 * economy's buildings produce under the player's model with the owner filter: their own storages, carriers, nation
 * and neutral talents. Its wares carry an owner tag in the island's one ledger account (`logs@2`), so each economy
 * spends and fills only its own pool, while finite source tokens (`~…`: trees, ore, stone, fish) stay shared and
 * every source is taken once by whichever economy reaches it first (the player's jobs come first). The modules the
 * fast model keeps for the player only (flax plots, fleet ships, saved deliveries, handcart receipts, yard exports,
 * workshop shelves, wildlife) leave the computer's saved work to the exact recovery ticks.
 */

/** The ledger name of `ware` in `owner`'s pool: the player's wares and the shared source tokens are untagged. */
const ownerWare = (ware: string, owner: number) =>
  owner === PLAYER_FACTION || ware.startsWith("~") ? ware : `${ware}${OFFLINE_OWNER_WARE_TAG}${owner}`;

/** The owner of a ledger ware: the tag's faction, else the player. */
const wareOwner = (ware: string) => {
  const tag = ware.lastIndexOf(OFFLINE_OWNER_WARE_TAG);
  if (tag < 0 || ware.startsWith("~")) return PLAYER_FACTION;
  const owner = Number(ware.slice(tag + 1));
  return Number.isSafeInteger(owner) && owner > PLAYER_FACTION ? owner : PLAYER_FACTION;
};

/** The name `owner`'s storages use for a ledger ware, or undefined for another owner's ware. */
const untagged = (ware: string, owner: number) => {
  if (wareOwner(ware) !== owner) return undefined;
  return owner === PLAYER_FACTION ? ware : ware.slice(0, ware.lastIndexOf(OFFLINE_OWNER_WARE_TAG));
};

/** A ledger ware under the name its owner's storages use. */
export const storageWareName = (ware: string) => untagged(ware, wareOwner(ware))!;

/** The ledger goods of one owner under the names its storages use. */
export const goodsOfOwner = (goods: Readonly<Goods>, owner: number): Goods => {
  const owned: Goods = {};
  for (const [ware, count] of Object.entries(goods)) {
    const name = untagged(ware, owner);
    if (name !== undefined) owned[name] = count;
  }
  return owned;
};

/** The ledger wares of one owner under the names its storages use. */
export const waresOfOwner = (wares: Iterable<string>, owner: number) => {
  const owned: string[] = [];
  for (const ware of wares) {
    const name = untagged(ware, owner);
    if (name !== undefined) owned.push(name);
  }
  return owned;
};

/** `owner`'s goods under their ledger names. */
export const taggedGoods = (goods: Readonly<EconomyGoods>, owner: number): EconomyGoods => {
  const tagged: EconomyGoods = {};
  for (const [ware, count] of Object.entries(goods)) tagged[ownerWare(ware, owner)] = count;
  return tagged;
};

/**
 * One computer production job in its owner's pool. Its flax farm waits (the flax plots are the player's model) and a
 * horizon refund goes back to its pool (the private loom receipt is the player's flax model too).
 */
const ownedJob = (job: OfflineEconomyJob, owner: number, flaxFarm: boolean): OfflineEconomyJob => {
  const { alternativeFoods, inputDeliveryTicks, inputTargets, outputSequence } = job;
  const owned: OfflineEconomyJob = {
    ...job,
    inputs: taggedGoods(job.inputs, owner),
    outputs: taggedGoods(job.outputs, owner),
    ...(alternativeFoods ? { alternativeFoods: alternativeFoods.map(ware => ownerWare(ware, owner)) } : {}),
    ...(inputDeliveryTicks ? { inputDeliveryTicks: taggedGoods(inputDeliveryTicks, owner) } : {}),
    ...(inputTargets ? { inputTargets: taggedGoods(inputTargets, owner) } : {}),
    ...(outputSequence ? { outputSequence: outputSequence.map(goods => taggedGoods(goods, owner)) } : {}),
    ...(flaxFarm ? { endTick: 0 } : {})
  };
  delete owned.privateRefundBuilding;
  return owned;
};

/** The computer economies a save runs: the map's AI factions and the ones a script woke (saved `economy`). */
const savedComputerEconomies = (save: GameSaveV1, world: WorldData) => {
  const woken = save.settlement.factionAi?.filter(entry => entry.economy).map(entry => entry.faction) ?? [];
  const mapped = computerEconomies({ options: { world } });
  if (!woken.length) return { economies: mapped, live: undefined };
  const live = [...new Set([...mapped, ...woken])].sort((first, second) => first - second);
  return { economies: live, live };
};

export interface OfflineComputerEconomy {
  owner: number;
  /** Its jobs already in its own pool (tagged wares). */
  rates: OfflineEconomyRates;
}

/** Every computer economy of the island with its rates; empty on every island without one. */
export const estimateOfflineComputerEconomies = (save: GameSaveV1, world: WorldData): OfflineComputerEconomy[] => {
  const { economies, live } = savedComputerEconomies(save, world);
  if (!economies.length) return [];
  const context = { factionAi: { liveEconomies: () => live }, options: { world },
    playerNation: save.settlement.playerNation };
  const flaxFarms = new Set(save.settlement.buildings.filter(building => building.typeId === OFFLINE_FLAX_FARM_TYPE)
    .map(building => `building:${building.uid}`));
  return economies.map(owner => {
    const nation = nationOf(context, owner) ?? "roman";
    const rates = estimateOfflineEconomyRates(save, world, { nation, owner });
    rates.jobs = rates.jobs.map(job => ownedJob(job, owner, flaxFarms.has(job.uid)));
    return { owner, rates };
  });
};

/** The computer economies' production jobs, after the player's (the player's jobs keep their places). */
export const computerEconomyJobs = (computers: readonly OfflineComputerEconomy[]) =>
  computers.flatMap(computer => computer.rates.jobs);
