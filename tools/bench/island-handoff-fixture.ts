export interface ColonyFixture {
  colonyId: number;
  save: Record<string, unknown>;
}

/** Composes an active-colony fixture from a home save without changing the game's save format. */
export const prepareColonyFixture = (input: Record<string, unknown>): ColonyFixture => {
  const archipelago = input.archipelago as Record<string, unknown> | undefined;
  if (typeof archipelago?.active === "number") {
    const settlement = input.settlement as { colony?: { island?: { id?: number } } } | undefined;
    const id = settlement?.colony?.island?.id;
    if (typeof id !== "number") throw new Error("The save is active but is not on a colony");
    return { colonyId: id, save: { ...input, savedAt: Date.now() } };
  }
  const now = Date.now();
  const islandSave = { ...input, archipelago: undefined, savedAt: now - 5 * 60_000 };
  const world = (input.settlement as { world: { seed: number } }).world;
  const island = {
    difficulty: "easy",
    id: 1,
    name: "Handoff review colony",
    ore: "ironOre",
    seed: world.seed,
    taken: false,
    voyageSeconds: 150
  };
  const settlement = input.settlement as Record<string, unknown>;
  const save = {
    ...input,
    savedAt: now,
    settlement: {
      ...settlement,
      colony: { forts: 0, island, status: "conquered", version: 1, conqueredAt: now - 86_400_000 }
    },
    archipelago: {
      active: 1,
      colonies: [{
        expeditionId: 1, island, status: "conquered",
        conqueredAt: now - 86_400_000, nextOreShipAt: now + 3_600_000
      }],
      home: islandSave,
      version: 1
    }
  };
  return { colonyId: 1, save };
};
