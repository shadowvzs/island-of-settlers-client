import type { I18n } from "@lingui/core";

import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { translateMessage } from "../../shared/i18n/translate";
import type { RoadNetwork } from "../../shared/settlement/road-types";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import type { WorldData } from "../../shared/world/world-data";
import { createClickDetector, createLongPressDetector } from "../click-detector";
import type { SettlementUi } from "../settlement-ui";
import { SETTLEMENT_MESSAGES as M } from "../settlement-ui/messages";
import { getTerrainSurveyTarget } from "../settlement-ui/terrain-survey/helpers";
import { createTerrainSurveyWindow } from "../settlement-ui/terrain-survey/terrain-survey-window";
import type { createDebugClickModes } from "./debug-click-modes";
import { isHostileBuilding } from "./hostile-building-tooltip-helpers";
import type { createMilitaryControls } from "./military-controls";
import type { createPlacementControls } from "./placement-controls";

interface SettlementClickOptions {
  /** False during a session transition: map clicks neither select nor dispatch commands. */
  canCommand?: () => boolean;
  debug: ReturnType<typeof createDebugClickModes>;
  i18n?: I18n;
  military: ReturnType<typeof createMilitaryControls>;
  mount: HTMLElement;
  placement: Pick<ReturnType<typeof createPlacementControls>, "isInteracting">;
  renderer: Pick<TerrainRenderer, "pickBridge" | "pickGround" | "pickShip" | "pickRoadDecoration">;
  onPickRoadDecoration?: (uid: number) => void;
  roads: Pick<RoadNetwork, "segments">;
  simulation: SettlementSimulation;
  ui: SettlementUi;
  world: WorldData;
  onMessage: (text: string, error?: boolean) => void;
  onPickBuilding: (x: number, y: number) => SettlementBuilding | undefined;
  /** Home-island shell collecting: true when the click collected a shore shell. */
  onPickShoreShell?: (x: number, y: number) => boolean;
  onUpdate: () => void;
}

/**
 * One click priority: active tools → military → ships → building plots → bridges → contextual empty terrain.
 * Right taps and touch long-presses go to the soldiers' smart orders after the active tools.
 */
export const createSettlementClickControls = ({
  canCommand, debug, i18n, military, mount, onMessage, onPickBuilding, onPickRoadDecoration, onPickShoreShell,
  onUpdate, placement, renderer, roads, simulation, ui, world
}: SettlementClickOptions) => {
  const targetAt = (point: { x: number; z: number }) =>
    getTerrainSurveyTarget(world, point, roads.segments(), i18n);
  const survey = createTerrainSurveyWindow({
    onDispatch: (job, point) => {
      const result = simulation.dispatchSurveyJob(job, point);
      if (result.ok) onMessage(translateMessage(i18n, M.actions.dispatched, { job }), false);
      onUpdate();
      return result;
    },
    onValidate: targetAt
  }, i18n);
  ui.root.append(survey.root);
  const stop = createClickDetector(mount, (x, y, event) => {
    if (!(canCommand?.() ?? true)) return;
    const debugMode = debug.active();
    if (debugMode && placement.isInteracting()) debugMode.set(false);
    else if (debugMode) { debugMode.click(x, y); return; }
    if (placement.isInteracting()) return;
    if (military.click(x, y, event)) return;
    const shipId = renderer.pickShip?.(x, y);
    if (shipId != null) { survey.close(); ui.focusShip(shipId); return; }
    const decoration = renderer.pickRoadDecoration?.(x, y);
    if (decoration != null && onPickRoadDecoration) { survey.close(); onPickRoadDecoration(decoration); return; }
    if (onPickShoreShell?.(x, y)) { survey.close(); onUpdate(); return; }
    const building = onPickBuilding(x, y);
    if (building) {
      survey.close();
      if (!isHostileBuilding(building)) ui.focusBuilding(building.uid);
      return;
    }
    const bridge = renderer.pickBridge?.(x, y);
    if (bridge != null) { survey.close(); ui.focusBridge(bridge); return; }
    const ground = renderer.pickGround(x, y);
    const target = ground && targetAt(ground);
    if (target) survey.open(target);
  });
  /**
   * Right tap (a touch long-press) orders the selected soldiers. The tool-cancel owners (placement, debug
   * modes, box select, observation) consume their right press first, so no tap reaches this then.
   */
  const orderAt = (x: number, y: number,
    event?: Pick<PointerEvent, "altKey" | "ctrlKey"> & { shiftKey?: boolean; touch?: boolean }) => {
    if (!(canCommand?.() ?? true) || debug.active() || placement.isInteracting()) return;
    military.order(x, y, event);
  };
  const stopRightTap = createClickDetector(mount, orderAt, 2);
  const stopLongPress = createLongPressDetector(mount, (x, y) => orderAt(x, y, { altKey: false, ctrlKey: false,
    shiftKey: false, touch: true }));
  return { dispose: () => { stop(); stopRightTap(); stopLongPress(); survey.dispose(); } };
};
