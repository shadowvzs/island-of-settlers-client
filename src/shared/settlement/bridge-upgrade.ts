import { COLONY_RESOURCE_TIERS } from "../world/colony-resource-tiers";
import { type BridgeKind, MAX_BRIDGE_LEVEL } from "./road-types";

/** Owner 2026-11-07: every bridge upgrade consumes two units of the target level's material. */
export const BRIDGE_UPGRADE_UNITS = 2;

/**
 * The material of the upgrade from saved level `savedLevel` (0–3) to the next level: level N uses
 * colony resource tier N − 1, as building levels do — the tier's planks for a wooden bridge, its stone
 * for a stone bridge. Undefined at the maximum level.
 */
export const bridgeUpgradeMaterial = (kind: BridgeKind, savedLevel: number): string | undefined => {
  if (!Number.isInteger(savedLevel) || savedLevel < 0 || savedLevel >= MAX_BRIDGE_LEVEL - 1) return undefined;
  const tier = COLONY_RESOURCE_TIERS[savedLevel]!;
  return kind === "wood" ? `${tier.wood}Planks` : tier.stone;
};

/** Stock of the next upgrade; empty at the maximum level. */
export const bridgeUpgradeCost = (kind: BridgeKind, savedLevel: number): Record<string, number> => {
  const material = bridgeUpgradeMaterial(kind, savedLevel);
  return material ? { [material]: BRIDGE_UPGRADE_UNITS } : {};
};
