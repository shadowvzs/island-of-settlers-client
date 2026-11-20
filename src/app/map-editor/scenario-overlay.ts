import type { I18n } from "@lingui/core";

import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { MapScenario, ScenarioBuilding, ScenarioUnit } from "../../shared/world/map-scenario";
import { getAuthoredDeposits } from "../../shared/world/marble-deposit";
import type { WorldData } from "../../shared/world/world-data";
import { troopPortrait } from "../settlement/army-icons";
import {
  getHostileCatapultIconSource, getNationBuildingIconSource, getSettlementBuildingIconSource
} from "../settlement-ui/building-icons";
import { stoneLabel } from "./marble-deposit-helpers";
import { editorMessage, MAP_EDITOR_MESSAGES as M, resolveEditorText } from "./messages";
import { scenarioBuildingName } from "./scenario-catapult-helpers";
import { troopLabel } from "./scenario-form-controls";

const DEFAULT_CAMP_THEME = "forest";

const createMarkerIcon = (source: string | undefined) => {
  if (!source) return undefined;
  const icon = document.createElement("img"); icon.src = source; icon.alt = "";
  return icon;
};

/** The nation's rendered soldier model: the same appearance Play spawns, not the flat troop symbol. */
export const getScenarioUnitMarkerSource = (
  scenario: Pick<MapScenario, "nation">, unit: Pick<ScenarioUnit, "type">
) => troopPortrait(scenario.nation, unit.type);

/**
 * A camp's themed model thumbnail. Camps with a model use the neutral camp/outpost render for the
 * scenario theme; a plain military building keeps its nation's building thumbnail.
 */
export const getScenarioBuildingMarkerSource = (
  scenario: Pick<MapScenario, "nation" | "theme">,
  building: Pick<ScenarioBuilding, "bandit" | "catapult" | "enclosure" | "type">
) => {
  if (building.catapult) return getHostileCatapultIconSource(building.catapult.variant);
  if (building.bandit === undefined) return getNationBuildingIconSource(building.type, scenario.nation);
  const theme = scenario.theme ?? DEFAULT_CAMP_THEME;
  return getSettlementBuildingIconSource(building.type, building.bandit, theme, building.enclosure) ??
    getNationBuildingIconSource(building.type, scenario.nation);
};

/**
 * Authored objects stay visible while editing. Play spawns the real soldiers and camp buildings
 * from these definitions; the overlay previews the same appearance with the nation's rendered
 * soldier portrait and the themed camp/building thumbnail. A live 3D spawn belongs to Play: the
 * editor also runs on maps without a settlement, so it keeps this lightweight DOM preview.
 */
export const createScenarioOverlay = (world: WorldData, viewport: HTMLElement, renderer: TerrainRenderer,
  i18n?: I18n, onSelectCatapult?: (id: number) => void) => {
  const root = document.createElement("div"); root.className = "map-editor__scenario-overlay";
  root.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5";
  viewport.append(root);
  let revision = -1, definition = world.scenario, locale = i18n?.locale;
  let markers: { x: number; z: number; element: HTMLElement }[] = [];
  const rebuild = () => {
    markers = []; root.replaceChildren(); definition = world.scenario; revision = world.buildRevision ?? 0;
    locale = i18n?.locale;
    const add = (point: { x: number; z: number }, label: string, icon?: HTMLElement, catapultId?: number) => {
      const element = document.createElement(catapultId !== undefined && onSelectCatapult ? "button" : "span");
      if (catapultId !== undefined && onSelectCatapult) {
        element.dataset.catapultId = String(catapultId);
        element.setAttribute("type", "button");
        element.setAttribute("aria-label", label);
        element.addEventListener("pointerdown", event => event.stopPropagation());
        element.addEventListener("click", event => { event.stopPropagation(); onSelectCatapult(catapultId); });
      }
      element.style.cssText = "position:absolute;display:flex;align-items:center;gap:3px;padding:2px 5px;" +
        "background:#20251de0;color:#fff;border:1px solid #e6cf92;border-radius:5px;font:12px system-ui";
      if (catapultId !== undefined && onSelectCatapult) { element.style.pointerEvents = "auto"; element.style.cursor = "pointer"; }
      if (icon) { icon.style.cssText = "width:32px;height:32px;object-fit:contain"; element.append(icon); }
      element.append(document.createTextNode(label)); root.append(element); markers.push({ ...point, element });
    };
    for (const deposit of getAuthoredDeposits(world))
      add(deposit, resolveEditorText(i18n, editorMessage(M.coordinate.depositOption, {
        material: stoneLabel(deposit.material ?? "marble"), number: deposit.id + 1, remaining: deposit.remaining
      })));
    if (!definition) return;
    if (definition.headquarters)
      add(definition.headquarters, resolveEditorText(i18n, M.scenario.hq),
        createMarkerIcon(getNationBuildingIconSource(0, definition.nation)));
    if (definition.landing) add(definition.landing, resolveEditorText(i18n, M.scenario.landing));
    for (const building of definition.buildings)
      add(building, resolveEditorText(i18n, building.catapult
        ? editorMessage(M.coordinate.scenarioBuildingOption, { id: building.id, name: scenarioBuildingName(building) })
        : editorMessage(M.scenario.camp, { defenders: building.defenders, id: building.id })),
        createMarkerIcon(getScenarioBuildingMarkerSource(definition, building)), building.catapult ? building.id : undefined);
    for (const unit of definition.units)
      add(unit, resolveEditorText(i18n, editorMessage(M.scenario.unitEntry, { id: unit.id, type: troopLabel(unit.type) })),
        createMarkerIcon(getScenarioUnitMarkerSource(definition, unit)));
  };
  return {
    dispose: () => { markers = []; root.remove(); },
    draw: (visible: boolean) => {
      if (!visible) { root.hidden = true; return; }
      root.hidden = false;
      if (definition !== world.scenario || revision !== (world.buildRevision ?? 0) || locale !== i18n?.locale)
        rebuild();
      for (const marker of markers) {
        const point = renderer.projectToViewport(marker.x,
          sampleSmooth(world, world.heights, marker.x, marker.z) + .4, marker.z);
        marker.element.style.transform = `translate(${Math.round(point.x)}px,${Math.round(point.y)}px) translate(-50%,-100%)`;
      }
    }
  };
};
