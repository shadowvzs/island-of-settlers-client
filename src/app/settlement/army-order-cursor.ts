import type { ArmyOrder } from "./army-rail/helpers";

import "./army-order-cursor.css";

/**
 * A cursor per pending order, the box-select mode, the smart right-click target modes (siege, board, store,
 * invalid; military controls §6, shown by the P3 target hover) and the selected ship's modes (sail, unload; §9).
 */
export type ArmyCursorMode =
  | Exclude<ArmyOrder, null> | "add" | "board" | "invalid" | "sail" | "siege" | "store" | "target" | "unload";

/**
 * The pending order owns the cursor; without one, the box-select mode shows its own, else the soldiers' hover
 * target (P3) shows what a right click would do there.
 */
export const getArmyCursorMode = (
  order: ArmyOrder, adding: boolean, hoverTarget: ArmyCursorMode | null = null
): ArmyCursorMode | null => {
  if (order) return order;
  return adding ? "add" : hoverTarget;
};

/** Marks the map surface; army-order-cursor.css maps each mode to its cursor image. */
export const applyArmyCursor = (surface: HTMLElement, mode: ArmyCursorMode | null) => {
  if (mode) surface.dataset.armyCursor = mode;
  else delete surface.dataset.armyCursor;
};
