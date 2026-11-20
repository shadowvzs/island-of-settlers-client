import type { I18n } from "@lingui/core";

import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import { type BoxSize, createMapTooltip } from "../helpers";
import {
  getHostileBuildingName, getHostileGarrisonRows, getHostileTooltipView, getTooltipCorner,
  type HostileTooltipView, isHostileBuilding
} from "./hostile-building-tooltip-helpers";
import type { MapHoverPick } from "./map-hover-pick";

import "./hostile-building-tooltip.css";

/** World units above the building's ground point where the tooltip's lower edge sits. */
const TOOLTIP_LIFT = 4;

interface HostileBuildingTooltipOptions {
  buildingName: (typeId: number) => string;
  /** The island's enemy army nation: its soldiers carry that nation's troop names. */
  enemyNation: () => string;
  /** Active Lingui instance: troop names, site names and labels follow the selected locale. */
  i18n?: I18n;
  /** The shared map hover: its pointer sample and its once-per-sample building pick. */
  hover: Pick<MapHoverPick, "building" | "subscribe">;
  /** Live intel only where the player sees the building (fog). */
  isVisible: (building: SettlementBuilding) => boolean;
  /** The map viewport: the tooltip is positioned inside it. */
  mount: HTMLElement;
  project: (x: number, y: number, z: number) => { x: number; y: number };
  simulation: Pick<SettlementSimulation, "buildings" | "militarySoldiers">;
}

const renderView = (element: HTMLElement, view: HostileTooltipView) => {
  const title = document.createElement("strong");
  title.textContent = view.title;
  const lines = view.rows.map(row => {
    const line = document.createElement("span");
    line.textContent = `${row.count} × ${row.label}`;
    return line;
  });
  if (view.empty) {
    const empty = document.createElement("span");
    empty.textContent = view.empty;
    lines.push(empty);
  }
  element.replaceChildren(title, ...lines);
};

/**
 * Hovering a building the player does not own shows the enemy soldiers inside it, above the building
 * (owner 2026-10-21). It follows the shared map hover (once per animation frame while the mouse moves) and
 * asks for no building pick while the island has no hostile building.
 */
export const createHostileBuildingTooltip = (options: HostileBuildingTooltipOptions) => {
  const tooltip = createMapTooltip(options.mount, "hostile-building-tooltip");
  tooltip.element.setAttribute("role", "tooltip");
  let shownKey = "";
  let size: BoxSize = { height: 0, width: 0 };

  const hide = () => {
    tooltip.hide();
    shownKey = "";
  };
  const render = (view: HostileTooltipView) => {
    renderView(tooltip.element, view);
    // One layout read per content change: the clamp below needs the rendered size.
    size = tooltip.measure();
    shownKey = view.key;
  };
  const show = (building: SettlementBuilding) => {
    const rows = getHostileGarrisonRows(
      options.simulation.militarySoldiers(), building.uid, options.enemyNation(), options.i18n
    );
    const view = getHostileTooltipView(
      getHostileBuildingName(building, options.buildingName, options.i18n), rows, options.i18n
    );
    if (view.key !== shownKey) render(view);
    const anchor = options.project(building.x, building.y + TOOLTIP_LIFT, building.z);
    tooltip.moveTo(getTooltipCorner(anchor, size, tooltip.bounds()));
  };
  const refresh = (hovering: boolean) => {
    if (!hovering || !options.simulation.buildings().some(isHostileBuilding)) return hide();
    const building = options.hover.building();
    if (!building || !isHostileBuilding(building) || !options.isVisible(building)) return hide();
    show(building);
  };
  const stop = options.hover.subscribe(sample => refresh(sample !== null));
  return {
    dispose: () => {
      stop();
      tooltip.dispose();
    }
  };
};
