import type { createDebugClickModes } from "./debug-click-modes";
import type { createSettlementDebugActions } from "./settlement-debug-actions";

type DebugClickModes = ReturnType<typeof createDebugClickModes>;
type SettlementDebugActions = ReturnType<typeof createSettlementDebugActions>;

/** The player entry's inert map-click debug controls; the real modes load only for admin/local dev. */
export const createNoDebugClickModes = (): DebugClickModes => ({
  active: () => undefined,
  dispose: () => undefined,
  controls: {
    buildingLevelMode: () => false,
    enemySpawnMode: () => false,
    shipSpawnMode: () => false,
    soldierSpawnMode: () => false,
    setBuildingLevelMode: () => undefined,
    setEnemySpawnMode: () => undefined,
    setShipSpawnMode: () => undefined,
    setSoldierSpawnMode: () => undefined,
    watchBuildingLevelMode: () => undefined,
    watchEnemySpawnMode: () => undefined,
    watchShipSpawnMode: () => undefined,
    watchSoldierSpawnMode: () => undefined
  }
});

/** The player entry's inert state-changing debug actions; no Development UI can reach them. */
export const createNoSettlementDebugActions = (): SettlementDebugActions => {
  const inactive = () => undefined;
  return {
    addDebugLevels: inactive,
    buildEveryBuilding: inactive,
    fillAllOutputs: inactive,
    upgradeOwnedRoads: inactive,
    grantCoins: inactive,
    grantDebugTroop: inactive,
    grantGems: inactive,
    grantHandcarts: inactive,
    resetCarriers: inactive,
    startDebugExpedition: inactive
  };
};
