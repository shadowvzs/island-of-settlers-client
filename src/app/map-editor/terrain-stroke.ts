import type { TerrainRenderer } from "../../render-common/renderer-contract";
import type { EditRefusal } from "../../shared/world/editing/edit-refusal";
import type { StampKind } from "../../shared/world/editing/terrain/terrain-edit-state";
import type { WorldData } from "../../shared/world/world-data";
import { type BrushRing,formatGhostBadge } from "./brush-preview";
import type { GroundPoint } from "./editor-input";
import type { EditorStore, EditorTool } from "./editor-store";
import { snapToStamp } from "./stamp-snap";
import type { TerrainTool } from "./terrain-tool";

/** A mountain drag longer than this (cells) draws a ridge instead of a click. */
const RIDGE_MIN = 3;

/** Stamp kind of a terrain tool (undefined: mountain), null for the other tools. */
export const getStampKind = (tool: EditorTool | null): StampKind | null => {
  if (tool?.kind === "lake") return "lake";
  return tool?.kind === "mountain" ? undefined : null;
};

/** The click lowers when exactly one of Ctrl and the Lower toggle is on (Ctrl flips it). */
export const isLowering = (ctrl: boolean, lowerMode: boolean) => ctrl !== lowerMode;

/** A terrain ghost's ring (the editor adds whether the last edit was refused). */
type TerrainRing = Omit<BrushRing, "refused">;

export interface TerrainStrokeOptions {
  nextSeed: () => number;
  renderer: Pick<TerrainRenderer, "pickGround" | "projectToViewport">;
  showRefusal: (refusal: EditRefusal | null) => void;
  store: EditorStore;
  terrain: TerrainTool;
  world: WorldData;
}

/**
 * The Mountain and Lake strokes: a press starts one, its end raises or lowers the stamp (Ctrl
 * or the Lower toggle) or, after a long drag, draws a ridge or channel; the ghost ring with its
 * raise / lower badge; and the ground pick, snapped to a stamp right beside the cursor.
 */
export const createTerrainStroke = (options: TerrainStrokeOptions) => {
  const { renderer, store, terrain, world } = options;
  /** Press of the current stroke (a click, or a ridge / channel drag). */
  let press: { ctrl: boolean; point: GroundPoint } | null = null;
  const getKind = () => getStampKind(store.getState().tool);
  const lowers = (ctrl: boolean) => isLowering(ctrl, store.getState().lowerMode);
  const project = (x: number, y: number, z: number) => renderer.projectToViewport(x, y, z);

  /** The stroke ended: a click raises / lowers, a long drag draws a ridge or channel. */
  const finish = (hover: GroundPoint | null) => {
    const started = press;
    const kind = getKind();
    press = null;
    if (!started || kind === null) return;
    const end = hover ?? started.point;
    const seed = options.nextSeed();
    const tool = store.getState().tool;
    const template = tool?.kind === "mountain" && tool.value === 1 ? "great-mountain-v1" : undefined;
    if (Math.hypot(end.x - started.point.x, end.z - started.point.z) >= RIDGE_MIN) {
      options.showRefusal(terrain.ridge(started.point, end, seed, kind, template));
      return;
    }
    options.showRefusal(terrain.click(started.point, lowers(started.ctrl), seed, kind, template));
  };

  /** The ghost ring of the next click with its badge (▲ / ▼ and the level it gives). */
  const getRing = (hover: GroundPoint, ctrl: boolean, kind: StampKind): TerrainRing | null => {
    const ghost = terrain.getGhost(press?.point ?? hover, lowers(ctrl), kind);
    if (!ghost) return null;
    const { radius, x, z } = ghost;
    return { badge: formatGhostBadge(ghost), radius, x, z };
  };

  /** Ground under a CSS pixel; with a terrain tool snapped to a stamp right beside it. */
  const pick = (x: number, y: number): GroundPoint | null => {
    const point = renderer.pickGround(x, y);
    const kind = getKind();
    if (kind === null) return point;
    return snapToStamp({ cursor: { x, y }, kind, point, project, state: terrain.state, world });
  };

  return {
    finish,
    getRing,
    pick,
    /** A terrain tool's press starts the stroke. */
    start: (point: GroundPoint, ctrl: boolean) => {
      press = { ctrl, point };
    }
  };
};
