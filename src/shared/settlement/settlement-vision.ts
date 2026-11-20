import { createFactionVision } from "./faction-vision";
import { createPlayerFog } from "./player-fog";
import { settlementTerritory } from "./settlement-territory";
import type { SettlementContext } from "./settlement-types";
import { markTickPhase } from "./tick-phase-profile";

/**
 * The per-faction vision layer and, on an island that shows fog, the player's fog of war it drives
 * (A13 phase 2). Expedition islands and worlds without fog keep the layer only.
 */
export const attachSettlementVision = (context: SettlementContext) => {
  const { world } = context.options;
  const fogged = !!world.fog && !world.expeditionKind;
  const vision = () => context.factionVision?.layer(0);
  context.playerFog = fogged ? createPlayerFog(world, vision) : undefined;
  context.factionVision = createFactionVision(world.cellsX, world.cellsZ, context.playerFog?.sink);
  return context.factionVision;
};

/**
 * The last tick phase (also after a movement or quiet skip step): the layer stamps the positions the tick
 * ended on, then the fog follows owned land and lookout charting, then the faction knowledge refreshes its
 * memories from the layer (A13 phase 3, its own profile phase). Readers see the end of the previous tick.
 */
export const updateSettlementVision = (context: SettlementContext) => {
  context.factionVision?.update(context);
  context.playerFog?.update(context, settlementTerritory(context).owned);
  markTickPhase("knowledge");
  context.factionKnowledge?.observe();
};

/** A load or a fresh island: the layer from the restored positions, then every fog cell again. */
export const rebuildSettlementVision = (context: SettlementContext) => {
  context.factionVision?.rebuild(context);
  context.playerFog?.rebuild(context, settlementTerritory(context).owned);
};
