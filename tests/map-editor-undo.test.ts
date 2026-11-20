import { describe, expect, it } from "vitest";

import { applyEditorTool, type EditContext } from "../src/app/map-editor/editor-apply";
import {
  createEditorHistory,
  type EditorHistory,
  HISTORY_LIMITS} from "../src/app/map-editor/editor-history";
import type { EditorTool } from "../src/app/map-editor/editor-store";
import { getHistoryShortcut } from "../src/app/map-editor/helpers";
import { isLowering } from "../src/app/map-editor/terrain-stroke";
import { createTreeGrowth } from "../src/render-common/growth/tree-growth";
import { SPECIES } from "../src/render-common/wildlife/wildlife-species";
import { createEditGround } from "../src/shared/world/editing/build-refresh";
import { TREE_PROPS } from "../src/shared/world/editing/prop-removal";
import { applyStampChanges } from "../src/shared/world/editing/terrain/terrain-apply";
import {
  clickStampAt,
  createTerrainEditState,
  raiseStampAt,
  removeStampsNear,
  type StampKind,
  type TerrainEditState
} from "../src/shared/world/editing/terrain/terrain-edit-state";
import type { PlacedAnimal } from "../src/shared/world/save/map-format";
import { MATERIAL, ORE, PROP, type WorldData } from "../src/shared/world/world-data";
import { findOpenSpots, findPropSpot, SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld } from "./helpers/cached-worlds";
import { diffSnapshots, snapshotState } from "./state-diff";


type Point = { x: number; z: number };

/** The editor's placed animals as the history sees them (always placeable here). */
const createAnimalRecord = () => {
  const placed: PlacedAnimal[] = [];
  return {
    list: (): readonly PlacedAnimal[] => placed,
    place: (species: number, x: number, z: number) => {
      placed.push({ species, x, z });
      return true;
    },
    remove: (animal: PlacedAnimal) => {
      placed.splice(
        placed.findLastIndex((entry) => entry.x === animal.x),
        1
      );
    }
  };
};

const createSession = () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD);
  const terrain = createTerrainEditState();
  const animals = createAnimalRecord();
  const rebuilds: { removed: number[]; restored: number[]; side: string }[] = [];
  const history = createEditorHistory({
    animals,
    flush: () => {},
    isQueued: () => false,
    rebuild: (_step, side, props) => rebuilds.push({ ...props, side }),
    terrain,
    world
  });
  let seeds = 0;
  const context: EditContext = {
    firstPlacedProp: world.props.count,
    ground: createEditGround(world),
    nextSeed: () => (seeds += 1),
    placeAnimal: animals.place,
    world
  };
  return { animals, context, history, rebuilds, terrain, world };
};

type Session = ReturnType<typeof createSession>;

/** One stroke (pointer down to up) of the edits: one undo step. */
const stroke = (history: EditorHistory, ...edits: (() => void)[]) => {
  history.begin();
  for (const edit of edits) edit();
  history.endStroke();
};

const useTool =
  (session: Session, tool: EditorTool, point: Point, brushSize = 3) =>
  () => {
    applyEditorTool(session.context, tool, point, brushSize);
  };

const raise = (session: Session, point: Point, kind?: StampKind) => () => {
  const { terrain, world } = session;
  applyStampChanges(world, terrain, [raiseStampAt(terrain, point.x, point.z, 7, kind)]);
};

/** A Mountain / Lake click with the editor's Lower toggle on (and Ctrl held or not). */
const clickWithLower = (session: Session, point: Point, ctrl: boolean, kind?: StampKind) => () => {
  const { terrain, world } = session;
  const click = { kind, lower: isLowering(ctrl, true), seed: 9 };
  applyStampChanges(world, terrain, [clickStampAt(terrain, point, click)!]);
};

const resetGround = (session: Session, point: Point) => () => {
  const { terrain, world } = session;
  applyStampChanges(world, terrain, removeStampsNear(terrain, point.x, point.z, 3));
  applyEditorTool(session.context, { kind: "resetGround", value: 0 }, point, 3);
};

/** A layer created by the first edit compares as zeros before it. */
const orZeros = (layer: Float32Array | Uint8Array | null | undefined, like: Float32Array) =>
  layer ?? new Uint8Array(like.length);

const copyTerrain = (terrain: TerrainEditState, world: WorldData) => ({
  lake: orZeros(terrain.lake, world.heights),
  nextId: terrain.nextId,
  ring: terrain.ring ?? new Float32Array(world.heights.length),
  rise: terrain.rise ?? new Float32Array(world.heights.length),
  ringCells: [...terrain.ringCells].sort((first, second) => first - second),
  stampProps: [...terrain.stampProps].sort(([first], [second]) => first - second),
  stamps: terrain.stamps
});

/** Every edited part of the world and terrain state (the build revision is runtime state). */
const captureState = ({ animals, terrain, world }: Session) => {
  const { buildRevision: _revision, lakeWater, terrainRevision: _terrainRevision, ...rest } = world;
  return snapshotState({
    ...rest,
    animals: [...animals.list()],
    lakeWater: orZeros(lakeWater, world.heights),
    terrain: copyTerrain(terrain, world)
  });
};

/** The stroke changes the world; undo brings back the state before exactly, redo the after. */
const expectUndoRedo = (session: Session, ...edits: (() => void)[]) => {
  const { history } = session;
  const before = captureState(session);
  stroke(history, ...edits);
  const after = captureState(session);
  expect(diffSnapshots(after, before)).not.toEqual([]);
  history.undo();
  expect(diffSnapshots(captureState(session), before)).toEqual([]);
  history.redo();
  expect(diffSnapshots(captureState(session), after)).toEqual([]);
};

const findWorldTree = (world: WorldData) => {
  const { props } = world;
  for (let index = 0; index < props.count; index += 1) {
    if (TREE_PROPS.has(props.types[index]!)) return { x: props.x[index]!, z: props.z[index]! };
  }
  throw new Error("no tree");
};

/** The standing tree at the point (its prop id). */
const findTreeId = (world: WorldData, point: Point) => {
  const { props } = world;
  for (let index = 0; index < props.count; index += 1) {
    const isTree = TREE_PROPS.has(props.types[index]!);
    if (isTree && props.x[index] === point.x && props.z[index] === point.z) return index;
  }
  throw new Error("no tree there");
};

/** Cells around the props spot the tests place trees and stones on. */
const PROP_OFFSETS = [
  [0, 0],
  [3, 0],
  [-3, 0],
  [6, 0],
  [0, 6]
] as const;
const SPOT_SPACING = 14;

describe("map editor undo / redo", () => {
  it("invalidates derived naval terrain caches on mountain edit, undo and redo", () => {
    const session = createSession(), point = session.world.start;
    stroke(session.history, raise(session, point), raise(session, point));
    const edited = session.world.terrainRevision ?? 0;
    expect(edited).toBeGreaterThan(0);
    session.history.undo();
    const undone = session.world.terrainRevision ?? 0;
    expect(undone).toBeGreaterThan(edited);
    session.history.redo();
    expect(session.world.terrainRevision).toBeGreaterThan(undone);
  });
  const session = createSession();
  const [mountain, lake, tiles, mine] = findOpenSpots(session.world, 4, SPOT_SPACING);
  const props = findPropSpot(
    session.world,
    PROP_OFFSETS,
    [mountain!, lake!, tiles!, mine!],
    SPOT_SPACING
  );

  it("undoes and redoes mountains, lakes and reset ground exactly", () => {
    expectUndoRedo(session, raise(session, mountain!));
    expectUndoRedo(session, raise(session, mountain!));
    expectUndoRedo(session, raise(session, lake!, "lake"));
    expectUndoRedo(session, raise(session, lake!, "lake"));
    expectUndoRedo(session, resetGround(session, mountain!));
  });

  it("undoes and redoes the Lower toggle's clicks (Ctrl flips them back) exactly", () => {
    const { terrain } = session;
    stroke(session.history, raise(session, mountain!), raise(session, mountain!));
    const level = () => terrain.stamps.find((stamp) => stamp.kind === undefined)!.level;
    expect(level()).toBe(2);
    expectUndoRedo(session, clickWithLower(session, mountain!, false));
    expect(level()).toBe(1);
    expectUndoRedo(session, clickWithLower(session, mountain!, true));
    expect(level()).toBe(2);
    expectUndoRedo(session, clickWithLower(session, lake!, false, "lake"));
    expectUndoRedo(session, clickWithLower(session, mountain!, false));
    expectUndoRedo(session, clickWithLower(session, mountain!, false));
    expect(terrain.stamps.some((stamp) => stamp.kind === undefined)).toBe(false);
  });

  it("undoes and redoes tiles, mine gravel and ore exactly", () => {
    const sand = { kind: "ground", value: MATERIAL.sand } as const;
    expectUndoRedo(session, useTool(session, sand, tiles!));
    const mineGravel = { kind: "ground", value: MATERIAL.mine } as const;
    expectUndoRedo(session, useTool(session, mineGravel, mine!, 4));
    expectUndoRedo(session, useTool(session, { kind: "ore", value: ORE.gold }, mine!));
  });

  it("undoes and redoes doodads, trees, removers and animals exactly", () => {
    const { x, z } = props;
    const stone = { kind: "stone", value: PROP.smallRock } as const;
    expectUndoRedo(session, useTool(session, stone, { x, z }));
    const oak = { kind: "tree", value: PROP.broadleafTree } as const;
    expectUndoRedo(session, useTool(session, oak, { x: x + 3, z }));
    expectUndoRedo(session, useTool(session, { kind: "eraser", value: 0 }, { x: x + 3, z }));
    const forest = findWorldTree(session.world);
    expectUndoRedo(session, useTool(session, { kind: "eraser", value: 0 }, forest));
    expectUndoRedo(session, useTool(session, { kind: "plantRemover", value: 0 }, forest, 6));
    const deer = { kind: "animal", value: SPECIES.deer } as const;
    expectUndoRedo(session, useTool(session, deer, { x, z: z + 3 }));
  });

  it("brings props back and takes them away for the felling and renderers", () => {
    const { history, rebuilds } = session;
    const oak = { kind: "tree", value: PROP.coniferTree } as const;
    stroke(history, useTool(session, oak, { x: props.x - 3, z: props.z }));
    const placed = session.world.props.count - 1;
    history.undo();
    history.redo();
    expect(rebuilds.slice(-2)).toEqual([
      { removed: [placed], restored: [], side: "before" },
      { removed: [], restored: [placed], side: "after" }
    ]);
  });

  it("lets a growing tree restored by undo grow again; placed trees stay out of growth", () => {
    const { history, world } = session;
    const forest = findWorldTree(world);
    const id = findTreeId(world, forest);
    const growth = createTreeGrowth([id], 5, () => true);
    growth.start();
    growth.update(1);
    const edit = useTool(session, { kind: "eraser", value: 0 }, forest, 1);
    stroke(history, edit);
    growth.remove([id]);
    history.undo();
    growth.restore(session.rebuilds.at(-1)!.restored);
    growth.update(2);
    expect(growth.frame.isGrowing(id)).toBe(true);
    const oak = { kind: "tree", value: PROP.broadleafTree } as const;
    stroke(history, useTool(session, oak, { x: props.x, z: props.z + 6 }));
    history.undo();
    history.redo();
    growth.restore(session.rebuilds.at(-1)!.restored);
    expect(session.rebuilds.at(-1)!.restored).toEqual([world.props.count - 1]);
    growth.update(3);
    expect(growth.frame.isGrowing(world.props.count - 1)).toBe(false);
  });

  it("keeps what play changed since the edit (a felled tree's cell)", () => {
    const { history, world } = session;
    const spot = { x: props.x + 6, z: props.z };
    const oak = { kind: "tree", value: PROP.birchTree } as const;
    const cell = Math.floor(spot.z) * world.cellsX + Math.floor(spot.x);
    const walkCost = world.walkCost[cell];
    stroke(history, useTool(session, oak, spot));
    expect(world.walkCost[cell]).not.toBe(walkCost);
    world.walkCost[cell] = 77;
    history.undo();
    expect(world.walkCost[cell]).toBe(77);
    history.redo();
  });

  it("keeps a multi stamp brush stroke as one step", () => {
    const { history } = session;
    const steps = history.stats().steps;
    const sand = { kind: "ground", value: MATERIAL.dirt } as const;
    const points = [0, 1, 2, 3].map((step) => ({ x: tiles!.x + step, z: tiles!.z + 2 }));
    expectUndoRedo(session, ...points.map((point) => useTool(session, sand, point)));
    expect(history.stats().steps).toBe(steps + 1);
  });

  it("clears the redo steps on a new edit", () => {
    const { history } = session;
    const grass = { kind: "ground", value: MATERIAL.grass } as const;
    stroke(history, useTool(session, grass, tiles!));
    history.undo();
    expect(history.getState().canRedo).toBe(true);
    stroke(history, useTool(session, grass, { x: tiles!.x, z: tiles!.z + 4 }));
    expect(history.getState()).toEqual({ canRedo: false, canUndo: true });
  });

  it("skips strokes that changed nothing and caps the steps", () => {
    const { history } = session;
    const steps = history.stats().steps;
    stroke(history);
    expect(history.stats().steps).toBe(steps);
    for (let step = 0; step < HISTORY_LIMITS.maxSteps + 5; step += 1) {
      const material = step % 2 === 0 ? MATERIAL.sand : MATERIAL.grass;
      stroke(history, useTool(session, { kind: "ground", value: material }, tiles!, 1));
    }
    expect(history.stats().steps).toBe(HISTORY_LIMITS.maxSteps);
    expect(history.stats().bytes).toBeLessThan(HISTORY_LIMITS.maxBytes);
  });
});

describe("history shortcuts", () => {
  const NO_KEYS = { altKey: false, ctrlKey: true, metaKey: false, shiftKey: false };
  const press = (key: string, modifiers: Partial<KeyboardEvent> = {}) =>
    getHistoryShortcut({ ...NO_KEYS, key, ...modifiers });

  it("maps Ctrl+Z to undo and Ctrl+Y / Ctrl+Shift+Z to redo", () => {
    expect(press("z")).toBe("undo");
    expect(press("Z", { shiftKey: true })).toBe("redo");
    expect(press("y")).toBe("redo");
    expect(press("z", { ctrlKey: false })).toBeNull();
    expect(press("x")).toBeNull();
  });
});
