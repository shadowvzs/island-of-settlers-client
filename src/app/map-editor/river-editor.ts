import {
  checkRiverWaterErasure, editAuthoredRiver, eraseRiverWater, isAuthoredRiverList,
  prepareRiverEditing, type RiverPoint
} from "../../shared/world/editing/authored-rivers";
import { prepareBakedRiverAdoption } from "../../shared/world/editing/baked-river-adoption";
import { editGeneratedRiver } from "../../shared/world/editing/generated-river-edit";
import type { GeneratedRiver } from "../../shared/world/editing/generated-river-types";
import { bakeTouchedStamps } from "../../shared/world/editing/terrain/terrain-brush";
import type { CellRegion } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import type { EditorHistory } from "./editor-history";
import type { EditorState, EditorStore } from "./editor-store";
import { editorMessage, type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";
import { createSectionStore, type FieldOption, keepOption } from "./section-store";
import type { TerrainTool } from "./terrain-tool";

/** Hint line confirmations of a finished river edit. */
export const RIVER_DONE = {
  drawn: M.river.drawnDone,
  erased: M.river.erased,
  mouth: M.river.mouth,
  removed: M.river.removed,
  size: M.river.size,
  source: M.river.source
} as const;

const NO_RIVERS: readonly FieldOption[] = [{ label: M.variable.riversNone, value: "" }];

/** Width/depth field labels and bounds: multipliers of a generated river, world units of a drawn one. */
export const getRiverDimensionFields = (generated: boolean) => generated
  ? { depthLabel: M.fields.riverDepthMultiplier as EditorText, depthMax: "4", depthMin: ".25", step: ".05",
    widthLabel: M.fields.riverWidthMultiplier as EditorText, widthMax: "4", widthMin: ".25" }
  : { depthLabel: M.fields.riverDepth as EditorText, depthMax: "3", depthMin: ".2", step: ".1",
    widthLabel: M.fields.riverWidth as EditorText, widthMax: "6", widthMin: "1" };

/** River tool modes (the river tool's value): draw, move source / mouth, erase water, trace baked. */
const RIVER_MODES = { adopt: 4, draw: 0, erase: 3, mouth: 2, source: 1 } as const;

/** Which river action is armed (pressed), from the editor's current tool. */
const toRiverPressed = (tool: EditorState["tool"]) => {
  const armed = (mode: number) => tool?.kind === "river" && tool.value === mode;
  return {
    adoptPressed: armed(RIVER_MODES.adopt), drawPressed: armed(RIVER_MODES.draw),
    erasePressed: armed(RIVER_MODES.erase), mouthPressed: armed(RIVER_MODES.mouth),
    sourcePressed: armed(RIVER_MODES.source)
  };
};

/** The rivers a player can select: generated / adopted ones first, then drawn ones. */
export const toRiverOptions = (
  world: Pick<WorldData, "authoredRivers" | "generatedRivers">
): readonly FieldOption[] => [
  ...(world.generatedRivers ?? []).map(river =>
    ({ label: editorMessage(M.coordinate.riverOption, {
      id: river.id, kind: river.adopted ? M.river.adopted : M.river.generated
    }), value: `g:${river.id}` })),
  ...(world.authoredRivers ?? []).map(river => ({ label: editorMessage(M.coordinate.riverOption, {
    id: river.id, kind: M.river.drawn
  }), value: `a:${river.id}` }))
];

export const createRiverEditor = (world: WorldData, store: EditorStore, history: EditorHistory,
  terrain: TerrainTool, onEdit: () => boolean | void, refreshed: (cells: CellRegion) => void,
  removedProps: (ids: readonly number[], cells: CellRegion) => void) => {
  const section = createSectionStore({
    ...getRiverDimensionFields(false),
    depth: ".6",
    listDisabled: true,
    options: NO_RIVERS,
    selected: "",
    selectionDisabled: true,
    status: "" as EditorText,
    width: "2",
    ...toRiverPressed(store.getState().tool)
  });
  store.subscribe(() => section.update(toRiverPressed(store.getState().tool)));
  /** The river last chosen (picked, drawn or edited): selected again when undo / redo brings it back. */
  let chosenId = "";
  const selectedRiver = () => section.get().selected === "" ? undefined :
    world.authoredRivers?.find(river => `a:${river.id}` === section.get().selected);
  const selectedGenerated = () => world.generatedRivers?.find(river => `g:${river.id}` === section.get().selected);
  let points: RiverPoint[] = [];
  const render = () => {
    const rivers = toRiverOptions(world);
    const options = rivers.length ? rivers : NO_RIVERS;
    section.update({ listDisabled: !rivers.length, options, selected: keepOption(options, chosenId) });
    const river = selectedRiver(), generated = selectedGenerated();
    section.update({ ...getRiverDimensionFields(Boolean(generated)), selectionDisabled: !(river || generated) });
    if (generated) section.update({ depth: String(generated.depthScale), width: String(generated.widthScale) });
    else if (river) section.update({ depth: String(river.depth), width: String(river.width) });
  };
  const number = (field: "depth" | "width", min: number, max: number) =>
    Math.max(min, Math.min(max, Number(section.get()[field]) || min));
  const apply = (done: EditorText, next: Parameters<typeof editAuthoredRiver>[1], remove?: number,
    erase?: RiverPoint, generated?: { river: GeneratedRiver | null; id: number; reshape?: boolean }) => {
    if (terrain.stats.busy) {
      store.setHint(M.hints.riverWait, true); return;
    }
    if ((next || generated?.river) && !section.reportValidity("width", "depth")) return;
    const previousGenerated = generated && world.generatedRivers?.find(river => river.id === generated.id);
    if (generated?.river && previousGenerated && !generated.reshape &&
      generated.river.widthScale === previousGenerated.widthScale &&
      generated.river.depthScale === previousGenerated.depthScale) {
      store.setHint(M.hints.riverNoChange); return;
    }
    if (next && !isAuthoredRiverList([
      ...(world.authoredRivers ?? []).filter(river => river.id !== next.id),
      { ...next, patches: [], falls: [] }
    ], world.cellsX, world.cellsZ)) {
      store.setHint(M.hints.riverNotConnected, true); return;
    }
    if (erase) {
      try { checkRiverWaterErasure(world, erase, store.getState().brushSize); }
      catch (error) {
        store.setHint(M.hints.waterErasureUnavailable, true);
        return;
      }
    }
    if (onEdit() === false) return;
    terrain.flush(); history.begin();
    history.begin();
    try {
      let editedVertices: readonly number[] | undefined;
      const bakeVertices = (vertices: readonly number[]) => {
        editedVertices = vertices;
        for (const vertex of vertices) bakeTouchedStamps(world, terrain.state, {
          x: vertex % (world.cellsX + 1), z: Math.floor(vertex / (world.cellsX + 1)), radius: .5
        });
      };
      const editRiverCells = () => {
        if (generated) return editGeneratedRiver(world, generated.river, generated.id, generated.reshape, bakeVertices);
        if (erase) return eraseRiverWater(world, erase, store.getState().brushSize, bakeVertices);
        return editAuthoredRiver(world, next, remove, bakeVertices);
      };
      const cells = editRiverCells();
      if (next) chosenId = `a:${next.id}`;
      if (generated?.river) chosenId = `g:${generated.id}`;
      // The channel is now part of the editor baseline, not a second layer that later stamps erase.
      const updateBase = (i: number) => {
        terrain.state.base!.heights[i] = world.heights[i]!;
        terrain.state.base!.waterSurface[i] = world.waterSurface[i]!;
      };
      if (terrain.state.base) {
        const waterVertices = "baseVertices" in cells ? cells.baseVertices as readonly number[] : undefined;
        if (editedVertices || waterVertices)
          for (const vertex of editedVertices ?? waterVertices!) updateBase(vertex);
        else for (let z = cells.minZ; z <= cells.maxZ + 1; z++)
          for (let x = cells.minX; x <= cells.maxX + 1; x++) updateBase(z * (world.cellsX + 1) + x);
      }
      if (cells.removed.length) removedProps(cells.removed, cells);
      history.note({ cells }); terrain.rebuildArea(cells, true, []); refreshed(cells);
      store.setHint(done);
    } catch (error) {
      // Include failures after a native commit or a renderer callback in the undo step.
      // Metadata/layers are captured at begin(); an empty rebuild region would hide recovery.
      history.note({ cells: { minX: 0, minZ: 0, maxX: world.cellsX - 1, maxZ: world.cellsZ - 1 } });
      store.setHint(M.hints.riverFailed, true);
    } finally { history.endStroke(); render(); }
  };
  /** Arms the river mode, or puts it away when it is already armed (its button shows pressed); true if armed. */
  const activate = (value: number) => {
    points = [];
    store.toggleTool("river", value);
    return store.getState().tool?.kind === "river";
  };
  const drawRiver = () => {
    if (!activate(RIVER_MODES.draw)) return;
    chosenId = "";
    section.update({ ...getRiverDimensionFields(false), depth: ".6", selected: "", width: "2" });
    store.setHint(M.hints.drawRiverHelp);
  };
  const adoptBaked = () => {
    if (!activate(RIVER_MODES.adopt)) return;
    store.setHint(M.hints.adoptRiverHelp);
  };
  const applyDimensions = () => {
    const river = selectedRiver(), generated = selectedGenerated();
    if (generated) apply(RIVER_DONE.size, null, undefined, undefined, { id: generated.id,
      river: { ...generated, widthScale: number("width", .25, 4), depthScale: number("depth", .25, 4) } });
    else if (river) apply(RIVER_DONE.size, { ...river, width: number("width", 1, 6), depth: number("depth", .2, 3) });
  };
  const removeSelected = () => {
    const river = selectedRiver(), generated = selectedGenerated();
    if (generated) apply(RIVER_DONE.removed, null, undefined, undefined, { id: generated.id, river: null });
    else if (river) apply(RIVER_DONE.removed, null, river.id);
  };
  const moveEndpoint = (value: number) => { if (selectedRiver() || selectedGenerated()) activate(value); };
  history.subscribe(render); render();
  const stamp = (point: RiverPoint, first: boolean) => {
    if (terrain.stats.busy) {
      points = []; store.setHint(M.hints.riverWait, true); return;
    }
    const mode = store.getState().tool?.value;
    if (mode === RIVER_MODES.draw || mode === RIVER_MODES.adopt) {
      if (first) points = [];
      const previous = points.at(-1);
      if (points.length < 2048 && (!previous || Math.hypot(previous.x - point.x, previous.z - point.z) >= .75))
        points.push({ ...point });
      return;
    }
    if (!first) return;
    if (mode === RIVER_MODES.erase) { apply(RIVER_DONE.erased, null, undefined, point); return; }
    const river = selectedRiver(), generated = selectedGenerated(), current = generated ?? river;
    if (!current) return;
    const next = current.points.map(point => ({ ...point }));
    next[mode === RIVER_MODES.source ? 0 : next.length - 1] = { ...point };
    const done = mode === RIVER_MODES.source ? RIVER_DONE.source : RIVER_DONE.mouth;
    if (generated) apply(done, null, undefined, undefined, { id: generated.id,
      river: { ...generated, points: next }, reshape: true });
    else if (river) apply(done, { ...river, points: next });
  };
  const adopt = (next: RiverPoint[]) => {
    try {
      const river = prepareBakedRiverAdoption(world, next);
      if (onEdit() === false) return;
      terrain.flush(); history.begin();
    history.begin();
      try {
        world.generatedRivers = [...world.generatedRivers ?? [], river];
        chosenId = `g:${river.id}`;
        history.note({ cells: { minX: 0, minZ: 0, maxX: world.cellsX - 1, maxZ: world.cellsZ - 1 } });
      } finally { history.endStroke(); render(); }
      store.setHint(M.hints.riverAdopted);
    } catch (error) {
      store.setHint(M.hints.riverAdoptFailed, true);
    }
  };
  const finish = () => {
    const tool = store.getState().tool;
    const tracing = tool?.kind === "river" && (tool.value === RIVER_MODES.draw || tool.value === RIVER_MODES.adopt);
    if (!tracing || points.length < 2) return;
    const next = points; points = [];
    if (tool.value === RIVER_MODES.adopt) { adopt(next); return; }
    const id = 1 + Math.max(0, ...(world.authoredRivers ?? []).map(river => river.id));
    if ((world.authoredRivers?.length ?? 0) >= 16) { store.setHint(editorMessage(M.hints.atMostRivers, { count: 16 }), true); return; }
    apply(RIVER_DONE.drawn, { id, points: next, width: number("width", 1, 6), depth: number("depth", .2, 3) });
  };
  return {
    adoptBaked, applyDimensions, drawRiver,
    eraseAtClick: () => activate(RIVER_MODES.erase),
    finish,
    moveMouth: () => moveEndpoint(RIVER_MODES.mouth),
    moveSource: () => moveEndpoint(RIVER_MODES.source),
    prepare: () => prepareRiverEditing(world),
    removeSelected,
    section,
    select: (selected: string) => { chosenId = selected; section.update({ selected }); render(); },
    stamp
  };
};

export type RiverEditor = ReturnType<typeof createRiverEditor>;
