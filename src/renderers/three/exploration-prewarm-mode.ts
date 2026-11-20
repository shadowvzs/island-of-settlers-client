/**
 * C11 rollback switch: `?prewarm=off` (dev params) or `globalThis.__explorationPrewarm = false`
 * keeps the possession entry lazy - no hero body preload, no first-frame tier/LOD reset - which
 * is exactly the behaviour before this card. Production never passes the switch.
 */
interface ExplorationPrewarmGlobal { __explorationPrewarm?: boolean }

export const setExplorationPrewarm = (enabled: boolean) => {
  (globalThis as ExplorationPrewarmGlobal).__explorationPrewarm = enabled;
};

export const explorationPrewarmEnabled = () =>
  (globalThis as ExplorationPrewarmGlobal).__explorationPrewarm !== false;
