import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { enemyNationFor } from "./enemy-nation";
import { hasEconomy, ownerOf, PLAYER_FACTION } from "./settlement-ownership";
import type { SettlementBuilding, SettlementContext, SettlementOptions } from "./settlement-types";

/** `world` is optional for bare talent fixtures; an island with an economy faction always has one. */
type NationOptions = Partial<Pick<SettlementOptions, "world">>;
type NationContext = Partial<Pick<SettlementContext, "playerNation">> & { options?: NationOptions };

interface ComputerNation { nation: WorkerNation; player: WorkerNation | undefined; seed: number }

/** One computer nation per island, memoised per options object (it follows the player's nation and the seed). */
const computerNations = new WeakMap<NationOptions, ComputerNation>();

/** The island's computer nation: the enemy army's nation (`enemyNationFor`), so towns and soldiers match. */
const computerNation = (options: NationOptions, player: WorkerNation | undefined) => {
  const seed = options.world?.seed ?? 0;
  const cached = computerNations.get(options);
  if (cached && cached.player === player && cached.seed === seed) return cached.nation;
  const nation = enemyNationFor(player ?? "roman", seed);
  computerNations.set(options, { nation, player, seed });
  return nation;
};

/**
 * The nation whose rules a faction's economy follows (EAI1a class b): the player's nation for the player
 * and for every faction without an economy (hostile sites keep today's rules); the island's computer
 * nation for a computer faction that runs an economy.
 */
export const nationOf = (context: NationContext, owner: number) => {
  const { options, playerNation } = context;
  if (owner === PLAYER_FACTION || !options || !hasEconomy(context, owner)) return playerNation;
  return computerNation(options, playerNation);
};

/** The nation of the economy a building belongs to: production rules, stock layout and drink. */
export const buildingNation = (context: NationContext, building: Pick<SettlementBuilding, "militaryFaction">) =>
  nationOf(context, ownerOf(building));
