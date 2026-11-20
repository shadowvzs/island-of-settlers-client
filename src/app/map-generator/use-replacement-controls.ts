import { useState } from "react";

import type { WorldData } from "../../shared/world/world-data";
import { getInitialIslandChoice, reloadWithNewIsland } from "./actions";
import { cliffBandsFor, replacementIslandChoice } from "./helpers";

/** A pending replacement choice never retags existing props or rewrites the current scenario. */
export const useReplacementControls = (
  world: WorldData,
  apply?: (choice: ReturnType<typeof replacementIslandChoice>, seed?: number) => void
) => {
  const [tier, setTier] = useState(world.colonyResourceTier);
  const [cliffBands, setCliffBands] = useState(() => Boolean(getInitialIslandChoice().cliffBands));
  return {
    cliffBands,
    tier,
    onCliffBandsChange: setCliffBands,
    onGenerate: () => {
      const choice = { ...replacementIslandChoice(getInitialIslandChoice(), world, tier),
        cliffBands: cliffBandsFor(cliffBands) };
      if (apply) apply(choice, world.seed);
      else reloadWithNewIsland(choice, world.seed);
    },
    onTierChange: setTier
  };
};
