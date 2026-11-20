import type { I18n } from "@lingui/core";

import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import { createBuildingLevelMode } from "./building-level-mode";
import type { DebugClickMode } from "./debug-click-mode";
import { createEnemySpawnMode } from "./enemy-spawn-mode";
import { createShipSpawnMode } from "./ship-spawn-mode";
import { createSoldierSpawnMode } from "./soldier-spawn-mode";

interface DebugClickModesOptions {
  /** Owner 2026-10-15: online players may use these map-click debug tools only as administrators. */
  allowed: boolean;
  buildingName: (typeId: number) => string;
  cancelPlacement: () => void;
  enemyNation: () => string;
  /** Active Lingui instance: toggle notices follow the selected locale. */
  i18n?: I18n;
  message: (text: string, warning?: boolean) => void;
  onRaised: () => void;
  pickBuilding: (x: number, y: number) => SettlementBuilding | undefined;
  pickGround: (x: number, y: number) => { x: number; z: number } | null;
  pickWater?: (x: number, y: number) => { x: number; z: number } | null;
  simulation: Pick<SettlementSimulation,
    "debugRaiseBuildingLevel" | "playerNation" | "spawnDebugEnemy" | "spawnDebugShip" | "spawnDebugSoldier">;
}

/** The Development tools that take over map clicks; at most one of them is on at a time. */
export const createDebugClickModes = (options: DebugClickModesOptions) => {
  const enemySpawn = createEnemySpawnMode(options);
  const soldierSpawn = createSoldierSpawnMode(options);
  const buildingLevel = createBuildingLevelMode(options);
  const shipSpawn = createShipSpawnMode({ ...options, pickGround: options.pickWater ?? options.pickGround });
  const modes = [enemySpawn, soldierSpawn, shipSpawn, buildingLevel];
  const setMode = (mode: DebugClickMode, active: boolean) => {
    if (!options.allowed || !active) { mode.set(false); return; }
    for (const other of modes) if (other !== mode) other.set(false);
    mode.set(true);
  };
  return {
    /** The mode that owns the next map click, if any. */
    active: () => options.allowed ? modes.find(mode => mode.active()) : undefined,
    dispose: () => { for (const mode of modes) mode.dispose(); },
    /** Development menu toggles; each `watch` hears every switch of its mode. */
    controls: {
      buildingLevelMode: buildingLevel.active,
      enemySpawnMode: enemySpawn.active,
      shipSpawnMode: shipSpawn.active,
      soldierSpawnMode: soldierSpawn.active,
      setBuildingLevelMode: (active: boolean) => setMode(buildingLevel, active),
      setEnemySpawnMode: (active: boolean) => setMode(enemySpawn, active),
      setShipSpawnMode: (active: boolean) => setMode(shipSpawn, active),
      setSoldierSpawnMode: (active: boolean) => setMode(soldierSpawn, active),
      watchBuildingLevelMode: buildingLevel.watch,
      watchEnemySpawnMode: enemySpawn.watch,
      watchShipSpawnMode: shipSpawn.watch,
      watchSoldierSpawnMode: soldierSpawn.watch
    }
  };
};

export type DebugClickModeControls = ReturnType<typeof createDebugClickModes>["controls"];
