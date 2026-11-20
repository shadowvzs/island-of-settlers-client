import type { BanditSiteRef } from "../../render-common/buildings/bandit-camp-plan";
import { nationalBuildingIconPath } from "../../render-common/buildings/building-icon-path";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import type { HostileCatapultVariant } from "../../shared/world/scenario-catapult";

const files = import.meta.glob<string>("../../../assets/building-icons/*.png", {
  eager: true, import: "default", query: "?url"
});
let selectedNation: WorkerNation = "roman";
// Building menus show the requested nation's actual model. Output/ore art belongs on road signs.
const sourceFor = (type: number, nation: WorkerNation = selectedNation) =>
  files[`../../../${nationalBuildingIconPath(nation, type)}`];
export const setSettlementBuildingIconNation = (nation: WorkerNation) => {
  selectedNation = nation;
  document.querySelectorAll<HTMLImageElement>("img[data-building-icon]").forEach(image => {
    if (image.dataset.banditSite !== undefined) return;
    const source = sourceFor(Number(image.dataset.buildingIcon));
    if (source) image.src = source;
  });
};

/** Thumbnail of a building type in one nation (independent of the selected settlement nation). */
export const getNationBuildingIconSource = (type: number, nation: WorkerNation) => sourceFor(type, nation);

/**
 * Thumbnail of a building type in the selected nation, or of a themed bandit site (files
 * `camp|outpost-<theme>-<bandit code>-<layout>.png`); undefined if none.
 */
export const getSettlementBuildingIconSource = (
  type: number, bandit?: BanditSiteRef, theme = "forest", enclosure?: "building"
) => {
  if (bandit === undefined) return sourceFor(type);
  const kind = enclosure === "building" ? "outpost" : "camp";
  return files[`../../../assets/building-icons/${kind}-${theme}-${bandit.code}-${bandit.layout}.png`];
};

/** Actual faction model thumbnail; never substitutes a national tower for an authored enemy. */
export const getHostileCatapultIconSource = (variant: HostileCatapultVariant) =>
  files[`../../../assets/building-icons/hostile-catapult-${variant}.png`];
