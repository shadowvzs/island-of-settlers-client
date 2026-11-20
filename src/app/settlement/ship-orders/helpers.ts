import type { I18n } from "@lingui/core";

import { translateDomainText } from "../../../shared/i18n/domain";
import { translateMessage } from "../../../shared/i18n/translate";
import { HARBOUR_TYPE_ID } from "../../../shared/settlement/building-type-ids";
import type { SettlementSimulation } from "../../../shared/settlement/settlement-simulation";
import type { SettlementBuilding, SettlementPoint } from "../../../shared/settlement/settlement-types";
import type { TroopShipActions } from "../../../shared/settlement/ship-troop-commands";
import type { TroopShipDestination } from "../../../shared/settlement/ship-troop-targets";
import type {
  ShipTargetMode, ShipTroopPanelState, ShipTroopReturnHome
} from "../../settlement-ui/ship-register/troop-types";
import type { ArmyCursorMode } from "../army-order-cursor";
import { SHIP_ORDER_FEEDBACK, SHIP_REFUSAL, type ShipDestinationKind } from "./constants";
import { SHIP_ORDER_MESSAGES as M } from "./messages";
import { TROOP_SHIP_REFUSALS } from "./refusal-messages";

type BoardingCheck = ReturnType<SettlementSimulation["troopShipBoardingCheck"]>;
type TroopShipStatus = NonNullable<ReturnType<SettlementSimulation["troopShipStatus"]>>;

/** A troop ship refusal of the simulation (English source sentence) in the active locale. */
export const translateShipRefusal = (reason: string, i18n?: I18n) => {
  const descriptor = TROOP_SHIP_REFUSALS[reason];
  return descriptor ? translateMessage(i18n, descriptor) : translateDomainText(reason, i18n);
};

/**
 * Why this selection cannot board (undefined: some can), from the read-only boarding check: the same plan
 * `embarkMilitary` applies, so the hover cursor and the click agree.
 */
export const boardingRefusal = (check: BoardingCheck): string | undefined => {
  if (!check.ok) return check.reason;
  if (check.boarding.length) return undefined;
  return check.waiting.length ? SHIP_REFUSAL.full : SHIP_REFUSAL.noneCanBoard;
};

/**
 * What a right tap means with this ship selected and no soldier selected: "Sail to" on multi-island maps, else
 * land the troops (colony and single-island maps, §9.3). An empty ship takes no right tap (owner answer 2).
 */
export const shipRightTapMode = (actions: Pick<TroopShipActions, "sailTo" | "unload"> | null): ShipTargetMode | null => {
  if (actions?.sailTo) return "sail";
  return actions?.unload ? "unload" : null;
};

/**
 * The map cursor: a soldier selection owns it (its hover target, null for the neutral cursor); without one the
 * selected ship's mode shows the generic sail / unload cursor (no validity check on hover).
 */
export const armyHoverCursor = (
  selectedSoldiers: number, soldierHover: ArmyCursorMode | null, shipMode: ShipTargetMode | null
): ArmyCursorMode | null => (selectedSoldiers > 0 ? soldierHover : shipMode);

/** A clicked own harbour docks / lands at its pier; any other point is a coast (or a harbour door nearby). */
export const shipDestinationAt = (
  building: Pick<SettlementBuilding, "typeId" | "uid"> | undefined, ground: SettlementPoint | null
): TroopShipDestination | null => {
  if (building?.typeId === HARBOUR_TYPE_ID) return { harbourUid: building.uid };
  return ground && { x: ground.x, z: ground.z };
};

/** The accepted order's feedback: sailed (troops aboard) or landed, at a harbour or a coast. */
export const shipOrderFeedback = (mode: ShipTargetMode, kind: ShipDestinationKind) => SHIP_ORDER_FEEDBACK[mode][kind];

/** The arming prompt of a target mode (also its panel button's purpose). */
export const shipModePrompt = (mode: ShipTargetMode) => (mode === "sail" ? M.sailPrompt : M.unloadPrompt);

/** Boarding feedback: on a colony a troop ship is called; elsewhere soldiers walk aboard. The rest wait. */
export const boardingFeedback = (pickup: boolean, waiting: number) => {
  if (pickup) return waiting ? M.pickupWaiting : M.pickupCalled;
  return waiting ? M.boardingWaiting : M.boarding;
};

const panelReturnHome = (
  kind: TroopShipActions["returnHome"], campaignReturnAllowed: boolean
): ShipTroopReturnHome | null => {
  if (kind === "campaignRun") return campaignReturnAllowed ? kind : null;
  return kind;
};

/** The troop panel of one own ship, from the simulation's context actions and status. */
export const shipTroopPanelState = (
  actions: TroopShipActions, status: TroopShipStatus, options: { armed: ShipTargetMode | null; campaignReturn: boolean }
): ShipTroopPanelState => ({
  aboard: status.aboard,
  armed: options.armed,
  board: actions.board,
  boarding: status.boarding,
  capacityLeft: status.capacityLeft,
  landing: status.landing,
  returnHome: panelReturnHome(actions.returnHome, options.campaignReturn),
  sailTo: actions.sailTo,
  unload: actions.unload
});
