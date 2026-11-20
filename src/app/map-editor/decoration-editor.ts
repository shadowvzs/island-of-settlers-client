import type { MessageDescriptor } from "@lingui/core";
import { propEntryByCode } from "@shared/catalog";

import { contentDescriptor } from "../../shared/i18n/content-text";
import { decorationScaleLimits, findDecoration,
  isDecoration, transformDecoration } from "../../shared/world/editing/decoration-editing";
import { isDecorationOnlyCell } from "../../shared/world/editing/decoration-spacing";
import { placeProp } from "../../shared/world/editing/prop-placement";
import { removePropsAt, STONE_PROPS } from "../../shared/world/editing/prop-removal";
import { EMPTY_REGION, expandRegion, getCircleRegion, unionRegions } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { REFUSAL_HINTS } from "./editor-catalog";
import type { EditorHistory } from "./editor-history";
import type { EditRefresher } from "./editor-refresh";
import type { EditorState, EditorStore } from "./editor-store";
import { editorMessage, type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";
import { createSectionStore } from "./section-store";

/** The name of a ground decoration model (the catalog text of its prop byte); empty for an unknown byte. */
export const decorationMessage = (kind: number): MessageDescriptor | "" => {
  const entry = propEntryByCode(kind);
  return entry ? contentDescriptor(entry.text.name) : "";
};

/** Decoration tool values: select on the map, move the selected one to a click (the palette places). */
const DECORATION_MODE = { move: 2, select: 1 } as const;
/** Ground radius of the selection highlight per unit of decoration scale (world units). */
const HIGHLIGHT_RADIUS = .55;

/** Which decoration tool is active (the pressed state of its buttons). */
export const toDecorationModes = (tool: EditorState["tool"]) => {
  const mode = tool?.kind === "decoration" ? tool.value : -1;
  return { moveActive: mode === DECORATION_MODE.move, selectActive: mode === DECORATION_MODE.select };
};

/** A new ground decoration: its prop kind, yaw (radians) and model scale. */
export interface GroundDecorationPlacement {
  propKind: number;
  rotation: number;
  scale: number;
}

/** Generated and authored decorations share stable ids, map layers, renderer and undo paths. */
export const createDecorationEditor = (
  world: WorldData, store: EditorStore, history: EditorHistory, refresher: EditRefresher,
  nextSeed: () => number, onEdit: () => boolean | void
) => {
  const section = createSectionStore({
    ...toDecorationModes(store.getState().tool), rotation: "0", scale: "1", scaleMax: "1.5", scaleMin: ".5",
    status: "" as EditorText, x: "1", z: "1"
  });
  store.subscribe(() => section.update(toDecorationModes(store.getState().tool)));
  let selected = -1;
  const render = () => {
    if (!isDecoration(world, selected)) {
      selected = -1;
      section.update({ status: M.variable.selectedTerrainNoSelection });
      return;
    }
    const props = world.props;
    const { max, min } = decorationScaleLimits(props.types[selected]!);
    section.update({
      rotation: String(Math.round(props.rotation[selected]! * 180 / Math.PI)),
      scale: String(Math.round(props.scale[selected]! * 100) / 100),
      scaleMax: String(max), scaleMin: String(min),
      status: editorMessage(M.variable.selectedDecoration, {
        index: selected,
        model: decorationMessage(props.types[selected]!)
      }),
      x: String(props.x[selected]), z: String(props.z[selected])
    });
  };
  const activate = (value: number) => {
    store.selectTool("decoration", value);
  };
  const mutate = (action: () => boolean) => {
    if (onEdit() === false) return false;
    history.begin();
    try { return action(); } finally {
      refresher.finishStroke();
      history.endStroke();
      render();
    }
  };
  const refreshProp = (id: number, previous: { x: number; z: number }, stone: boolean) => {
    const cells = expandRegion(world, unionRegions(
      getCircleRegion(world, previous.x, previous.z, 1),
      getCircleRegion(world, world.props.x[id]!, world.props.z[id]!, 1)), 2);
    const change = { cells, ground: false, mineStones: false, props: true, removed: [id],
      stoneCells: stone ? cells : EMPTY_REGION };
    history.note(change);
    // Hiding the original instance also lets the placed layer redraw transformed generated props.
    refresher.queue(change);
  };
  const transform = (point?: { x: number; z: number }) => {
    if (!isDecoration(world, selected)) { store.setHint(M.hints.decorationFirst, true); return; }
    const valid = point ? section.reportValidity("rotation", "scale") :
      section.reportValidity("x", "z", "rotation", "scale");
    if (!valid) return;
    mutate(() => {
      const previous = { x: world.props.x[selected]!, z: world.props.z[selected]! };
      const result = transformDecoration(world, selected, {
        rotation: section.valueAsNumber("rotation") * Math.PI / 180, scale: section.valueAsNumber("scale"),
        x: point?.x ?? section.valueAsNumber("x"), z: point?.z ?? section.valueAsNumber("z")
      });
      if (result.refusal) { store.setHint(REFUSAL_HINTS[result.refusal], true); return false; }
      refreshProp(selected, previous, STONE_PROPS.has(world.props.types[selected]!));
      store.setHint(M.hints.decorationUpdated);
      return true;
    });
  };
  const remove = () => {
    if (!isDecoration(world, selected)) return false;
    return mutate(() => {
      const previous = { x: world.props.x[selected]!, z: world.props.z[selected]! };
      const stone = STONE_PROPS.has(world.props.types[selected]!);
      removePropsAt(world, [selected]);
      refreshProp(selected, previous, stone);
      return true;
    });
  };
  history.subscribe(render);
  render();
  /** The selected decoration's ground ring while the select or move tool is active, else null. */
  const getHighlight = () => {
    const { moveActive, selectActive } = section.get();
    if (!(moveActive || selectActive) || !isDecoration(world, selected)) return null;
    const props = world.props;
    return { radius: HIGHLIGHT_RADIUS * props.scale[selected]!, refused: false, x: props.x[selected]!,
      z: props.z[selected]! };
  };
  /** Places a new ground decoration at the point (palette); false when the spot refuses it. */
  const placeAt = (point: { x: number; z: number }, placement: GroundDecorationPlacement) => mutate(() => {
    // Editor authoring: several ground decorations may share a cell blocked only by decorations.
    const id = placeProp(world, { kind: placement.propKind, seed: nextSeed(), ...point,
      shareBlockedCell: cell => isDecorationOnlyCell(world, cell) });
    if (typeof id === "string") { store.setHint(REFUSAL_HINTS[id], true); return false; }
    const { max, min } = decorationScaleLimits(placement.propKind);
    selected = id;
    world.props.scale[id] = Math.max(min, Math.min(max, placement.scale));
    world.props.rotation[id] = placement.rotation;
    refreshProp(id, point, STONE_PROPS.has(placement.propKind));
    store.setHint(M.hints.decorationPlaced);
    return true;
  });
  /** Removes the nearest ground decoration around the point; false when there is none. */
  const removeAt = (point: { x: number; z: number }) => {
    const found = findDecoration(world, point.x, point.z);
    if (found < 0) return false;
    selected = found;
    return remove();
  };
  const stamp = (point: { x: number; z: number }) => {
    const mode = store.getState().tool?.value;
    if (mode === DECORATION_MODE.select) { selected = findDecoration(world, point.x, point.z); render(); return; }
    if (mode === DECORATION_MODE.move) transform(point);
  };
  return {
    applyTransform: () => transform(),
    getHighlight,
    limits: { x: world.cellsX - .01, z: world.cellsZ - .01 },
    moveToClick: () => activate(DECORATION_MODE.move),
    placeAt,
    remove,
    removeAt,
    section,
    selectOnMap: () => activate(DECORATION_MODE.select),
    stamp
  };
};

export type DecorationEditor = ReturnType<typeof createDecorationEditor>;
