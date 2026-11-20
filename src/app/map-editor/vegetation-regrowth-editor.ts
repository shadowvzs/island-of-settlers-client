import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { listPaintedCells } from "../../shared/world/editing/brush";
import type { TerrainComponent } from "../../shared/world/editing/terrain/terrain-component";
import { regrowVegetation } from "../../shared/world/editing/vegetation-regrowth";
import { EMPTY_REGION, expandRegion, getCellsRegion } from "../../shared/world/grid-geometry";
import { PROP, type WorldData } from "../../shared/world/world-data";
import type { EditorHistory } from "./editor-history";
import type { EditRefresher } from "./editor-refresh";
import type { EditorStore } from "./editor-store";
import { pickViewCentre } from "./helpers";
import { editorMessage, type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";
import { createSectionStore, type FieldOption } from "./section-store";

export const REGROWTH_SPECIES: readonly FieldOption[] = [
  { label: M.option.regrowthSpecies.currentBiome, value: String(-1) },
  { label: M.option.regrowthSpecies.oak, value: String(PROP.broadleafTree) },
  { label: M.option.regrowthSpecies.conifer, value: String(PROP.coniferTree) },
  { label: M.option.regrowthSpecies.birch, value: String(PROP.birchTree) },
  { label: M.option.regrowthSpecies.palm, value: String(PROP.palmTree) },
  { label: M.option.regrowthSpecies.hardwood, value: String(PROP.hardwoodTree) },
  { label: M.option.regrowthSpecies.cedar, value: String(PROP.cedarTree) },
  { label: M.option.regrowthSpecies.walnut, value: String(PROP.walnutTree) },
  { label: M.option.regrowthSpecies.mahogany, value: String(PROP.mahoganyTree) }
];

export const createVegetationRegrowthEditor = (world: WorldData, viewport: HTMLElement, renderer: TerrainRenderer,
  store: EditorStore, history: EditorHistory, refresher: EditRefresher, options: {
    selection: () => TerrainComponent | null;
    canPlant: (x: number, z: number) => boolean;
    adoptPlaced: (ids: readonly number[]) => void;
    onEdit: () => boolean | void;
    busy: () => boolean;
  }) => {
  const section = createSectionStore({
    density: ".5",
    seed: String(world.seed >>> 0),
    spacing: "2.5",
    species: "-1",
    status: "" as EditorText
  });
  const listViewCentreCells = () => {
    const point = pickViewCentre(renderer, viewport);
    if (!point) return undefined;
    return listPaintedCells(world, { ...point, radius: store.getState().brushSize, softness: 0 })
      .map(entry => entry.cell);
  };
  const apply = (contour: boolean) => {
    if (options.busy()) { store.setHint(M.hints.vegetationWait, true); return; }
    if (!section.reportValidity("seed", "density", "spacing")) return;
    const cells = contour ? options.selection()?.cells : listViewCentreCells();
    if (!cells?.length) { store.setHint(M.hints.vegetationSelection, true); return; }
    if (options.onEdit() === false) return;
    history.begin();
    try {
      const result = regrowVegetation(world, { cells, seed: section.number("seed", 0, 0xffffffff),
        density: section.valueAsNumber("density"), spacing: section.valueAsNumber("spacing"),
        species: Number(section.get().species), age: store.getState().treeAge,
        canPlant: options.canPlant });
      if (result.placed.length) {
        const affected = expandRegion(world, getCellsRegion(world, result.placed.map(id =>
          Math.floor(world.props.z[id]!) * world.cellsX + Math.floor(world.props.x[id]!))), 5);
        const work = { cells: affected, ground: false, mineStones: false, props: true, removed: [], stoneCells: EMPTY_REGION };
        history.note(work); options.adoptPlaced(result.placed); refresher.queue(work); refresher.finishStroke();
      }
      section.update({ status: editorMessage(M.hints.vegetationDone, {
        attempts: result.attempts, placed: result.placed.length, requested: result.requested, seed: result.seed
      }) });
    } catch { store.setHint(M.hints.vegetationFailed, true); }
    finally { history.endStroke(); }
  };
  return { regrowInBrush: () => apply(false), regrowInContour: () => apply(true), section };
};

export type VegetationRegrowthEditor = ReturnType<typeof createVegetationRegrowthEditor>;
