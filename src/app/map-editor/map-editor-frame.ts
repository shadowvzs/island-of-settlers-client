import { type createBrushPreview } from "./brush-preview";
import type { DecorationEditor } from "./decoration-editor";
import type { GroundPoint } from "./editor-input";
import type { EditRefresher } from "./editor-refresh";
import type { EditorStore, EditorTool } from "./editor-store";
import { type createTerrainStroke, getStampKind } from "./terrain-stroke";

type BrushPreview = ReturnType<typeof createBrushPreview>;
type TerrainStroke = ReturnType<typeof createTerrainStroke>;

/** The pointer state shared by the input (writes) and the preview ring (reads). */
export interface EditorPointer {
  ctrl: boolean;
  hover: GroundPoint | null;
}

export interface EditorFrameLoopOptions {
  decorationEditor: DecorationEditor;
  /** The selected decoration's ground ring. */
  decorationHighlight: BrushPreview;
  getEnabled: () => boolean;
  getRefused: () => boolean;
  getRingRadius: (tool: EditorTool | null, brushSize: number) => number;
  input: { refreshHover: () => void };
  isActive: () => boolean;
  isDisposed: () => boolean;
  /** The map overlays of the editor sections. */
  overlays: { draw: (enabled: boolean) => void };
  pointer: EditorPointer;
  preview: BrushPreview;
  refresher: EditRefresher;
  store: EditorStore;
  terrainStroke: Pick<TerrainStroke, "getRing">;
}

/** The editor's animation frame: section overlays, queued rebuilds, hover and the brush preview ring. */
export const createEditorFrameLoop = (options: EditorFrameLoopOptions) => {
  const { pointer, store } = options;
  let frameHandle = 0;

  /** The preview ring: a terrain tool's ghost footprint, else the brush or a placement. */
  const getRing = () => {
    const { brushSize, tool } = store.getState();
    const kind = getStampKind(tool);
    if (!options.isActive() || !pointer.hover) return null;
    if (kind === null) return { ...pointer.hover, radius: options.getRingRadius(tool, brushSize) };
    return options.terrainStroke.getRing(pointer.hover, pointer.ctrl, kind);
  };

  const frame = () => {
    if (options.isDisposed()) return;
    options.overlays.draw(options.getEnabled());
    options.refresher.tick();
    options.input.refreshHover();
    const ring = getRing();
    options.preview.draw(ring && { ...ring, refused: options.getRefused() });
    options.decorationHighlight.draw(
      options.getEnabled() ? options.decorationEditor.getHighlight() : null
    );
    frameHandle = requestAnimationFrame(frame);
  };

  return {
    start: () => { frameHandle = requestAnimationFrame(frame); },
    stop: () => cancelAnimationFrame(frameHandle)
  };
};
