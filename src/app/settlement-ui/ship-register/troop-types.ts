/** The ship window's troop panel contract (military controls §9.3): the settlement implements the port. */

/** A map target mode the panel arms: "Sail to" a harbour or coast, or "Unload troops" at a coast. */
export type ShipTargetMode = "sail" | "unload";

/** How "Return home" works on this island: the colony recall or the campaign run's end. */
export type ShipTroopReturnHome = "campaignRun" | "colonyRecall";

export type ShipTroopAction = ShipTargetMode | "returnHome";

/** What the panel shows for one own ship: context actions (`troopShipActions`) and status (`troopShipStatus`). */
export interface ShipTroopPanelState {
  aboard: number;
  /** The target mode armed for this ship, if any. */
  armed: ShipTargetMode | null;
  /** Soldiers selected on the map could board it here. */
  board: boolean;
  boarding: number;
  /** Free deck slots (cavalry and the commander take two). */
  capacityLeft: number;
  landing: number;
  returnHome: ShipTroopReturnHome | null;
  sailTo: boolean;
  unload: boolean;
}

export interface ShipTroopPort {
  /** The panel of an own ship; null for a visitor or an unknown ship. */
  panel: (shipId: string) => ShipTroopPanelState | null;
  run: (shipId: string, action: ShipTroopAction) => void;
  /** The ship window shows this ship (null: closed). Selecting a ship arms its right-tap "Sail to". */
  select: (shipId: string | null) => void;
}
