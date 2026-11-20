import type { I18n } from "@lingui/core";

import type { MilitarySelection } from "../military-selection";
import { ARMY_TARGET_MARKER_TONES } from "./constants";
import { type ArmyTargetModifiers, armyTargetTone, resolveArmyTarget } from "./helpers";
import type { createArmyOrderMarker } from "./order-marker";
import { createSmartArmyOrder } from "./smart-order";
import { type ArmyTargetPickOptions, collectArmyTargetPicks } from "./target-picks";

export interface ArmyTargetOrderOptions extends ArmyTargetPickOptions {
  i18n?: I18n;
  marker: ReturnType<typeof createArmyOrderMarker>;
  selection: MilitarySelection;
  message: (message: string, error?: boolean) => void;
}

/**
 * The smart right-click order (military controls §6) at a viewport point: pick once, resolve, carry it out,
 * then show the marker and write the feedback to the message line (refusals in the error style).
 */
export const createArmyTargetOrders = (options: ArmyTargetOrderOptions) => {
  const execute = createSmartArmyOrder(options);
  return (x: number, y: number, modifiers?: ArmyTargetModifiers) => {
    const target = resolveArmyTarget(collectArmyTargetPicks(options, x, y, modifiers?.touch), modifiers);
    const result = execute(target, options.selection.ids(), modifiers?.shiftKey);
    options.marker.show({ x, y }, result.accepted ? armyTargetTone(target) : ARMY_TARGET_MARKER_TONES.refused);
    options.message(result.text, !result.accepted);
    return result.accepted;
  };
};
