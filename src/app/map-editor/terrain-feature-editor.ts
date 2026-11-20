import { getMaxLevel, getStampRadius } from "../../shared/world/editing/terrain/terrain-stamps";
import type { WorldData } from "../../shared/world/world-data";
import { REFUSAL_HINTS } from "./editor-catalog";
import type { EditorHistory } from "./editor-history";
import type { EditorStore } from "./editor-store";
import { editorMessage, type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";
import { createSectionStore, type FieldOption, keepOption } from "./section-store";
import type { TerrainTool } from "./terrain-tool";

/** Existing authored features retain their seed/profile; generated base relief has no editable feature id. */
export const createTerrainFeatureEditor = (
  world: WorldData, terrain: TerrainTool, history: EditorHistory, store: EditorStore, onEdit: () => boolean | void
) => {
  const section = createSectionStore({
    details: "" as EditorText, level: "1", levelMax: "6", options: [] as readonly FieldOption[],
    selected: "", x: "0", z: "0"
  });
  const selected = () => terrain.state.stamps.find(stamp => String(stamp.id) === section.get().selected);
  const showSelected = () => {
    const stamp = selected();
    if (!stamp) {
      section.update({ details: M.feature.empty }); return;
    }
    section.update({
      details: editorMessage(M.feature.details, { id: stamp.id, radius: getStampRadius(stamp).toFixed(1) }),
      level: String(stamp.level), levelMax: String(getMaxLevel(stamp)), x: String(stamp.x), z: String(stamp.z)
    });
  };
  const refresh = () => {
    const previous = section.get().selected;
    const options = terrain.state.stamps.map(stamp => ({
      label: editorMessage(M.coordinate.featureOption, {
        id: stamp.id,
        kind: stamp.kind === "lake" ? M.feature.lakeChannel : M.feature.mountainRidge,
        level: stamp.level
      }),
      value: String(stamp.id)
    }));
    section.update({ options, selected: keepOption(options, previous) });
    showSelected();
  };
  const apply = (remove: boolean) => {
    const stamp = selected();
    if (!stamp) return;
    if (terrain.stats.busy) { store.setHint(M.hints.featureWait, true); return; }
    if (!remove && !section.reportValidity("x", "z", "level")) return;
    if (onEdit() === false) return;
    history.begin();
    const refusal = terrain.editFeature(stamp.id, remove ? null :
      { x: section.valueAsNumber("x"), z: section.valueAsNumber("z"), level: section.number("level", 1, 6) });
    terrain.flush(); history.endStroke();
    store.setHint(refusal ? REFUSAL_HINTS[refusal] : M.feature.updated, !!refusal);
    refresh();
  };
  history.subscribe(refresh); refresh();
  return {
    apply: () => apply(false),
    limits: { x: world.cellsX, z: world.cellsZ },
    refresh,
    remove: () => apply(true),
    retryRebuild: () => { terrain.retryRebuild(); },
    section,
    select: (value: string) => { section.update({ selected: value }); showSelected(); }
  };
};

export type TerrainFeatureEditor = ReturnType<typeof createTerrainFeatureEditor>;
