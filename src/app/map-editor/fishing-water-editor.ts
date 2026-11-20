import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { fishingSites } from "../../shared/settlement/settlement-fishing";
import { createScenarioInspectionContext } from "../../shared/settlement/settlement-map-scenario";
import type { WorldData } from "../../shared/world/world-data";
import type { EditorStore } from "./editor-store";
import { pickViewCentre, runDeferredInspection } from "./helpers";
import { editorMessage, type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";
import { createSectionStore } from "./section-store";

/** Distinct legal shore/cast pairs in the 25×25 cells around the point. */
const countFishingSites = (world: WorldData, centre: { x: number; z: number }) => {
  const context = createScenarioInspectionContext(world), sites = new Set<string>();
  const cx = Math.floor(centre.x), cz = Math.floor(centre.z);
  for (let z = Math.max(0, cz - 12); z <= Math.min(world.cellsZ - 1, cz + 12); z++)
    for (let x = Math.max(0, cx - 12); x <= Math.min(world.cellsX - 1, cx + 12); x++)
      for (const site of fishingSites(context, { id: z * world.cellsX + x, kind: "fish", x: x + .5, z: z + .5 }))
        sites.add(`${site.approach!.x.toFixed(3)}/${site.approach!.z.toFixed(3)}/${site.x.toFixed(3)}/${site.z.toFixed(3)}`);
  return sites.size;
};

/** Fish already inhabit suitable water; editor authors the habitat, never invents a fish ledger. */
export const createFishingWaterEditor = (world: WorldData, viewport: HTMLElement, renderer: TerrainRenderer,
  store: EditorStore) => {
  const section = createSectionStore({
    busy: false,
    status: "" as EditorText
  });
  const inspect = () => {
    const centre = pickViewCentre(renderer, viewport);
    if (!centre) { section.update({ status: M.hints.aimAtTerrainOrShore }); return; }
    section.update({ busy: true });
    runDeferredInspection(section, () =>
      editorMessage(M.inspection.fishingStatus, { count: countFishingSites(world, centre) }),
    M.inspection.fishingFailed);
  };
  return {
    inspect,
    section,
    shapeLake: () => store.toggleTool("lake", 0),
    shapeSea: () => store.toggleTool("terrain", 5)
  };
};

export type FishingWaterEditor = ReturnType<typeof createFishingWaterEditor>;
