/**
 * Owner-tunable gameplay numbers (owner decision 2026-10-19, TODO ARCH-02). Each domain file is pure
 * data with no runtime imports, so workers and a future server can load it. Technical constants
 * (caches, phases, render dimensions, budgets, debug flags) stay beside the code that owns them.
 *
 * - colonies: colony limits, offers, voyages, counterattacks, forts (deck capacity: the `ship:sailingShip` entry)
 * - economy: walking speeds, roads, storage, production tempo, carts
 * - population: start settlers, island limits, settler growth, residences
 * - military: troop profiles, recruit costs, garrisons, archers, doors, forts, commander weights
 * - offline: the offline catch-up cap
 * - resources: colony stone deposits
 * - territory: territory radii per building
 *
 * Economy balance (player levels, quests, adventure rewards, material tiers, talents, trade, starter stock, road
 * speeds, colony lifetime) is shared with the API: `@shared/catalog/balance` (data/balance.json).
 */
export * from "./colonies";
export * from "./economy";
export * from "./military";
export * from "./offline";
export * from "./population";
export * from "./resources";
export * from "./territory";
