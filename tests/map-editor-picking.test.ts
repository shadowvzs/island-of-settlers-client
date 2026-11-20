import { describe, expect, it } from "vitest";

import { formatGhostBadge } from "../src/app/map-editor/brush-preview";
import { createEditorInput, type GroundPoint } from "../src/app/map-editor/editor-input";
import { createEditorStore } from "../src/app/map-editor/editor-store";
import {
  buildConvexHull,
  getHullDistance,
  SNAP_PIXELS,
  snapToStamp,
  type StampSnapInput
} from "../src/app/map-editor/stamp-snap";
import {
  createTerrainStroke,
  isLowering,
  type TerrainStrokeOptions
} from "../src/app/map-editor/terrain-stroke";
import {
  createTerrainTool,
  type TerrainTool,
  type TerrainToolOptions
} from "../src/app/map-editor/terrain-tool";
import { PICK_HEIGHT_RANGE,pickGroundAlongRay } from "../src/render-common/ground-pick";
import {
  addStamp,
  createTerrainEditState,
  findStampAt,
  getPickRatio,
  type TerrainEditState
} from "../src/shared/world/editing/terrain/terrain-edit-state";
import {
  getStampRadius,
  getTotalRise,
  type TerrainStamp
} from "../src/shared/world/editing/terrain/terrain-stamps";
import { sampleSmooth } from "../src/shared/world/grid-geometry";
import type { WorldData } from "../src/shared/world/world-data";
import { getIsoViewRay, projectIsoToViewport } from "./iso-view";

type Listener = (event: Partial<PointerEvent>) => void;

/** A canvas stand-in at the page origin that records its pointer listeners. */
const createFakeCanvas = () => {
  const listeners = new Map<string, Listener>();
  const keys = new EventTarget();
  const canvas = {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    ownerDocument: { defaultView: keys },
    removeEventListener: (type: string) => listeners.delete(type),
    setPointerCapture: () => undefined
  };
  const fire = (type: string, x: number, y: number) =>
    listeners.get(type)!({
      button: 0,
      clientX: x,
      clientY: y,
      ctrlKey: false,
      pointerId: 1,
      shiftKey: false,
      stopPropagation: () => undefined
    });
  const press = (type: "keydown" | "keyup", key: string) =>
    keys.dispatchEvent(Object.assign(new Event(type), { key }));
  const right = (type: string) => {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      button: 2, composedPath: () => [canvas, keys]
    });
    keys.dispatchEvent(event);
    return event;
  };
  return { canvas: canvas as unknown as HTMLElement, fire, press, right };
};

/**
 * The editor input over a ground that can rise: `raise()` lifts it, so the same pixel shows a
 * different ground point (as after a mountain stamp under a resting cursor).
 */
const createRaisableInput = () => {
  const { canvas, fire, press } = createFakeCanvas();
  let lift = 0;
  const hovers: (GroundPoint | null)[] = [];
  const controls: boolean[] = [];
  const input = createEditorInput({
    canvas,
    isActive: () => true,
    onCancel: () => undefined,
    onHover: (point, ctrl) => {
      hovers.push(point);
      controls.push(ctrl);
    },
    onStamp: () => undefined,
    onStrokeEnd: () => undefined,
    pick: (x, y) => ({ x: x / 10 - lift, z: y / 10 - lift }),
    spacing: () => 1
  });
  return { controls, fire, hovers, input, press, raise: () => (lift += 4) };
};

describe("map editor picking", () => {
  it("right click finishes an accepted stroke and deselects the tool without a further stamp", () => {
    const { canvas, fire, right } = createFakeCanvas();
    let active = true;
    let strokes = 0;
    const stamps: GroundPoint[] = [];
    const input = createEditorInput({
      canvas,
      isActive: () => active,
      onCancel: () => { active = false; },
      onHover: () => undefined,
      onStamp: point => { stamps.push(point); },
      onStrokeEnd: () => { strokes++; },
      pick: (x, y) => ({ x, z: y }),
      spacing: () => 1
    });
    fire("pointerdown", 100, 100);
    expect(stamps).toEqual([{ x: 100, z: 100 }]);
    for (const type of ["pointerdown", "contextmenu", "pointerup"])
      expect(right(type).defaultPrevented).toBe(true);
    fire("pointermove", 105, 105);
    fire("pointerup", 105, 105);
    expect(active).toBe(false);
    expect(strokes).toBe(1);
    expect(stamps).toHaveLength(1);
    input.dispose();
  });

  it("a press sets the hover point: a still click is never read as a drag", () => {
    const { fire, hovers, raise } = createRaisableInput();
    fire("pointermove", 100, 100);
    raise();
    fire("pointerdown", 100, 100);
    expect(hovers.at(-1)).toEqual({ x: 6, z: 6 });
  });

  it("re-picks the resting pointer when the ground under it changed", () => {
    const { fire, hovers, input, raise } = createRaisableInput();
    fire("pointermove", 100, 100);
    raise();
    input.refreshHover();
    expect(hovers.at(-1)).toEqual({ x: 6, z: 6 });
    fire("pointerleave", 0, 0);
    const count = hovers.length;
    input.refreshHover();
    expect(hovers.length).toBe(count);
  });

  it("Ctrl over a resting pointer flips the preview at once", () => {
    const { controls, fire, input, press } = createRaisableInput();
    fire("pointermove", 100, 100);
    press("keydown", "Control");
    input.refreshHover();
    expect(controls.at(-1)).toBe(true);
    press("keyup", "Control");
    input.refreshHover();
    expect(controls.at(-1)).toBe(false);
  });

  it("the terrain ghost says whether the click raises or lowers", () => {
    const options = {
      builders: { keepEditWorkers: () => undefined },
      world: {} as WorldData
    } as unknown as TerrainToolOptions;
    const terrain = createTerrainTool(options);
    const mountain = terrain.getGhost({ x: 10, z: 10 }, false, undefined)!;
    const lake = terrain.getGhost({ x: 10, z: 10 }, false, "lake")!;
    expect(formatGhostBadge(mountain)).toBe("▲ 1");
    expect(formatGhostBadge(lake)).toBe("▼ 1");
    expect(formatGhostBadge({ level: 3, raises: false })).toBe("▼ 3");
  });
});

const SIZE = 48;
const VIEW = { centerX: 24, centerZ: 24, viewportHeight: 900, viewportWidth: 1200, zoom: 1 };
const PEAK = { x: 24, z: 24 };
const POND = { x: 10, z: 38 };

/** Flat ground with the stamps' mountains raised on it (heights per vertex). */
const createStampWorld = (stamps: readonly TerrainStamp[]) => {
  const heights = new Float32Array((SIZE + 1) * (SIZE + 1));
  const stride = SIZE + 1;
  heights.forEach((_, vertex) => {
    heights[vertex] = 1 + getTotalRise(stamps, vertex % stride, Math.floor(vertex / stride));
  });
  return { cellsX: SIZE, cellsZ: SIZE, heights } as unknown as WorldData;
};

/** A level 6 mountain, a ridge and a lake on one small map, seen in the iso view. */
const createSnapScene = () => {
  const state = createTerrainEditState();
  addStamp(state, PEAK, 6, 11);
  addStamp(state, { x: 8, z: 10 }, 4, 12, { to: { x: 18, z: 8 } });
  addStamp(state, POND, 3, 13, { kind: "lake" });
  const world = createStampWorld(state.stamps.filter((stamp) => stamp.kind !== "lake"));
  const project = (x: number, y: number, z: number) => projectIsoToViewport(VIEW, x, y, z);
  const pick = (cursor: { x: number; y: number }) =>
    pickGroundAlongRay(world, getIsoViewRay(VIEW, cursor.x, cursor.y, PICK_HEIGHT_RANGE.max));
  const onScreen = (point: GroundPoint) =>
    project(point.x, sampleSmooth(world, world.heights, point.x, point.z), point.z);
  /** What the editor's pick gives at the cursor for the tool's kind. */
  const snapAt = (cursor: { x: number; y: number }, kind?: "lake"): GroundPoint | null => {
    const input: StampSnapInput = { cursor, kind, point: pick(cursor), project, state, world };
    return snapToStamp(input);
  };
  return { onScreen, pick, snapAt, state, world };
};

/** The first ground point beyond the stamp's pick zone, going away from the camera. */
const findBehindZone = (state: TerrainEditState, stamp: TerrainStamp) => {
  let distance = getPickRatio(stamp) * getStampRadius(stamp) * 0.5;
  const at = () => ({ x: stamp.x - distance / Math.SQRT2, z: stamp.z - distance / Math.SQRT2 });
  while (findStampAt(state, at().x, at().z, stamp.kind)) distance += 0.05;
  return at();
};

describe("map editor picking near a stamp's outline", () => {
  const scene = createSnapScene();
  const [, ridge, pond] = scene.state.stamps;

  it("keeps a click a hair above a mountain's tip on that mountain", () => {
    const tip = scene.onScreen(PEAK);
    const cursor = { x: tip.x, y: tip.y - 4 };
    const behind = scene.pick(cursor)!;
    expect(findStampAt(scene.state, behind.x, behind.z)).toBeNull();
    expect(scene.snapAt(cursor)).toEqual(PEAK);
    expect(scene.snapAt({ x: tip.x + 6, y: tip.y - 2 })).toEqual(PEAK);
  });

  it("snaps a ray that left the map to the stamp beside it, else gives no ground", () => {
    const tip = scene.onScreen(PEAK);
    const input = { cursor: { x: tip.x, y: tip.y - 3 }, point: null, state: scene.state };
    const project = (x: number, y: number, z: number) => projectIsoToViewport(VIEW, x, y, z);
    const world = scene.world;
    expect(snapToStamp({ ...input, kind: undefined, project, world })).toEqual(PEAK);
    const far = { ...input, cursor: { x: tip.x + 400, y: tip.y - 40 } };
    expect(snapToStamp({ ...far, kind: undefined, project, world })).toBeNull();
  });

  it("leaves picks in a pick zone, far from stamps and in front of them as they are", () => {
    const tip = scene.onScreen(PEAK);
    const inZone = scene.onScreen({ x: PEAK.x + 1, z: PEAK.z + 1 });
    expect(scene.snapAt(inZone)).toEqual(scene.pick(inZone));
    const above = { x: tip.x, y: tip.y - SNAP_PIXELS - 30 };
    expect(scene.snapAt(above)).toEqual(scene.pick(above));
    const flank = scene.onScreen({ x: PEAK.x + 6, z: PEAK.z + 5 });
    const front = scene.pick(flank)!;
    expect(findStampAt(scene.state, front.x, front.z)).toBeNull();
    expect(scene.snapAt(flank)).toEqual(front);
    expect(scene.snapAt(tip, "lake")).toEqual(scene.pick(tip));
  });

  it("snaps to the ridge point under the cursor and to a lake just behind its zone", () => {
    const middle = { x: (ridge!.x + ridge!.toX!) / 2, z: (ridge!.z + ridge!.toZ!) / 2 };
    const top = scene.onScreen(middle);
    const cursor = { x: top.x, y: top.y - 10 };
    const behind = scene.pick(cursor)!;
    expect(findStampAt(scene.state, behind.x, behind.z)).toBeNull();
    const snapped = scene.snapAt(cursor)!;
    expect(Math.hypot(snapped.x - middle.x, snapped.z - middle.z)).toBeLessThan(0.3);
    expect(findStampAt(scene.state, snapped.x, snapped.z)).toBe(ridge);
    const beyond = scene.onScreen(findBehindZone(scene.state, pond!));
    expect(scene.snapAt(beyond, "lake")).toEqual(POND);
  });

  it("measures the screen distance to a convex hull (0 inside)", () => {
    const hull = buildConvexHull([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ]);
    expect(hull).toHaveLength(4);
    expect(getHullDistance({ x: 5, y: 5 }, hull)).toBe(0);
    expect(getHullDistance({ x: 5, y: -3 }, hull)).toBeCloseTo(3);
    expect(getHullDistance({ x: 13, y: 14 }, hull)).toBeCloseTo(5);
  });
});

/** A terrain tool stand-in that records its clicks (a real ghost from the stamps). */
const createRecordingTerrain = () => {
  const real = createTerrainTool({
    builders: { keepEditWorkers: () => undefined },
    world: {} as WorldData
  } as unknown as TerrainToolOptions);
  const clicks: boolean[] = [];
  const terrain = {
    ...real,
    click: (_point: GroundPoint, lower: boolean) => {
      clicks.push(lower);
      return null;
    }
  } as unknown as TerrainTool;
  return { clicks, terrain };
};

const createStroke = () => {
  const store = createEditorStore();
  const { clicks, terrain } = createRecordingTerrain();
  const stroke = createTerrainStroke({
    nextSeed: () => 1,
    renderer: { pickGround: () => null, projectToViewport: () => ({ depth: 0, x: 0, y: 0 }) },
    showRefusal: () => undefined,
    store,
    terrain,
    world: {} as WorldData
  } satisfies TerrainStrokeOptions);
  store.toggleTool("mountain");
  return { clicks, store, stroke, terrain };
};

describe("map editor Lower toggle", () => {
  it("lowers when exactly one of Ctrl and the toggle is on", () => {
    expect(isLowering(false, false)).toBe(false);
    expect(isLowering(true, false)).toBe(true);
    expect(isLowering(false, true)).toBe(true);
    expect(isLowering(true, true)).toBe(false);
  });

  it("turns Mountain and Lake clicks into Ctrl clicks, Ctrl flips them back", () => {
    const { clicks, store, stroke } = createStroke();
    const click = (ctrl: boolean) => {
      stroke.start({ x: 5, z: 5 }, ctrl);
      stroke.finish({ x: 5, z: 5 });
    };
    click(false);
    store.toggleLowerMode();
    click(false);
    click(true);
    store.toggleTool("lake");
    click(false);
    expect(clicks).toEqual([false, true, false, true]);
  });

  it("flips the ring's badge at once", () => {
    const { store, stroke, terrain } = createStroke();
    addStamp(terrain.state, { x: 5, z: 5 }, 2, 1);
    const badge = (ctrl: boolean) => stroke.getRing({ x: 5, z: 5 }, ctrl, undefined)?.badge;
    expect(badge(false)).toBe("▲ 3");
    store.toggleLowerMode();
    expect(store.getState().lowerMode).toBe(true);
    expect(badge(false)).toBe("▼ 1");
    expect(badge(true)).toBe("▲ 3");
    expect(stroke.getRing({ x: 5, z: 5 }, false, "lake")).toBeNull();
  });
});
