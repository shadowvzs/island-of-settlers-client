import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { createExternalStore } from "../../src/app/components/ui-store";
import { BuildView } from "../../src/app/settlement-ui/main-panel/build-view";
import type { MainPanelVisibility } from "../../src/app/settlement-ui/main-panel/main-panel";
import { createSettlementUiStore } from "../../src/app/settlement-ui/ui-store";
import { BUILDING_CATALOG } from "../../src/render-common/buildings/building-catalog";
import type { WorkerNation } from "../../src/render-common/workers/worker-unit";
import { buildingUnlockLevel } from "../../src/shared/progression/building-unlocks";

/** Real menu fixture deliberately offers all types, including long colony specialist names. */
export const mountBuildMenuTextReview = (nation: string) => {
  document.body.style.cssText = "background:#647954;margin:0";
  const root = document.createElement("div");
  root.className = "settlement-ui";
  root.style.pointerEvents = "auto";
  document.body.append(root);
  const panel = document.createElement("section");
  panel.className = "settlement-ui__panel";
  panel.style.cssText = "position:relative;inset:auto;margin:16px;max-height:850px";
  root.append(panel);
  const store = createSettlementUiStore();
  const update = (level: number) => store.update({ playerNation: nation as WorkerNation,
    player: { nation, level, experience: 0, current: 0, needed: 0, fraction: 0, gems: 0, quests: [], stock: {}, talents: {} },
    buildableTypes: BUILDING_CATALOG.map(entry => entry.id),
    lockedBuildings: BUILDING_CATALOG.filter(entry => buildingUnlockLevel(entry.id) > level)
      .map(entry => `${entry.id}:${buildingUnlockLevel(entry.id)}`).join(",") });
  update(1);
  Object.assign(window, { __buildTextReview: update });
  createRoot(panel).render(createElement(BuildView, { store,
    panel: createExternalStore<MainPanelVisibility>({ opened: 1, view: "build", visible: true }), canSurvey: false,
    onHomeSandbox: () => {}, onPickBuilding: () => {}, onRoadTool: () => {}, onSurveyJob: () => {} }));
};
