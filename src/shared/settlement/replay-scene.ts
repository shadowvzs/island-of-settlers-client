import { refreshBuildClassRegion } from "../world/build-class";
import { refreshWalkCost } from "../world/editing/build-refresh";
import { removePropsAt } from "../world/editing/prop-removal";
import { resizeProps } from "../world/editing/prop-set";
import { isBlockingProp } from "../world/generation/gameplay";
import { expandRegion } from "../world/grid-geometry";
import { bumpBuildRevision, markWorldChangedAll } from "../world/save/world-change-journal";
import type { WorldData } from "../world/world-data";
import { BLOCKING } from "../world/world-data";
import type { SettlementOptions } from "./settlement-types";

const REPLAY_SCENE_HOOKS = ["canHarvestTree", "getFelledTreePhase", "onFellTree", "onPlantTree",
  "resourceTargets", "consumeResource", "getHuntTarget", "hitHuntTarget", "now", "playerLevel", "onAnimalProduced"] as const;
type Hook = typeof REPLAY_SCENE_HOOKS[number];
const UNDEFINED = { $sceneUndefined: true };
const copy = (value: unknown): unknown => value === undefined ? UNDEFINED : JSON.parse(JSON.stringify(value));
const restore = (value: unknown) => value && typeof value === "object" && "$sceneUndefined" in value ? undefined : value;
/** Animal production passes a large mutable building object; identity is enough to match the observed call. */
const observedArgs = (hook: Hook, args: unknown[]) => {
  if (hook !== "onAnimalProduced") return copy(args);
  const building = args[0] as { uid: number; typeId: number };
  return copy([{ uid: building.uid, typeId: building.typeId }]);
};
const fields = ["types", "x", "y", "z", "scale", "rotation", "phase", "form"] as const;
export type ReplaySceneEvent =
  { frame: true } | { hooks: Hook[]; unlockAllBuildings: boolean } |
  { hook: Hook; args: unknown; result: unknown } |
  { props: number[][]; count: number };

/** A bounded observation journal: no animal AI or renderer is needed to replay its responses. */
export const createReplaySceneJournal = (world: WorldData) => {
  let active = false, bytes = 0, overflow = false;
  let events: ReplaySceneEvent[] = [];
  let previous: Float32Array[] = [];
  let previousCount = 0;
  let configured: Hook[] = [];
  let unlockAllBuildings = false;
  let executingSimulation: (() => boolean) | undefined;
  const snapshot = () => {
    previousCount = world.props.count;
    previous = fields.map((field, index) => {
      const layer = previous[index]?.length === previousCount ? previous[index]! : new Float32Array(previousCount);
      layer.set(world.props[field].subarray(0, previousCount)); return layer;
    });
  };
  const append = (event: ReplaySceneEvent) => {
    const size = JSON.stringify(event).length;
    if (size > 256 * 1024 || bytes + size > 8 * 1024 * 1024 || events.length >= 100000) {
      overflow = true; return;
    }
    bytes += size; events.push(event);
  };
  const observeWorld = () => {
    if (!active || overflow) return;
    const props: number[][] = [];
    for (let id = 0; id < world.props.count; id++) {
      let changed = id >= previousCount;
      for (let index = 0; !changed && index < fields.length; index++)
        changed = world.props[fields[index]!][id] !== previous[index]![id];
      if (!changed) continue;
      props.push([id, ...fields.map(field => world.props[field][id] ?? 0)]);
    }
    if (!props.length && world.props.count === previousCount) return;
    append({ props, count: world.props.count }); snapshot();
  };
  return {
    wrap: (options: SettlementOptions): SettlementOptions => {
      // Scenes recorded before the game clock journalled `now`; the clock is now deterministic from the ticks.
      const wrapped = { ...options };
      unlockAllBuildings = options.unlockAllBuildings ?? false;
      configured = REPLAY_SCENE_HOOKS.filter(hook => typeof wrapped[hook] === "function");
      for (const hook of REPLAY_SCENE_HOOKS) {
        const original = wrapped[hook]; if (!original) continue;
        Object.assign(wrapped, { [hook]: (...args: unknown[]) => {
          if (!active || (executingSimulation && !executingSimulation()))
            return Reflect.apply(original, options, args);
          const result = Reflect.apply(original, options, args);
          append({ hook, args: observedArgs(hook, args), result: copy(result) });
          if (["onPlantTree", "onFellTree", "consumeResource", "hitHuntTarget", "onAnimalProduced"].includes(hook)) observeWorld();
          return result;
        } });
      }
      return wrapped;
    },
    /** UI previews call the same read hooks, but those queries are not replayed commands. */
    scopeToSimulation: (executing?: () => boolean) => { executingSimulation = executing; },
    begin: () => { events = []; bytes = 0; overflow = false; snapshot(); active = true; append({ hooks: configured, unlockAllBuildings }); },
    beforeUpdate: () => { if (!active) return; append({ frame: true }); observeWorld(); },
    afterCommand: observeWorld,
    stop: () => {
      // Renderer-owned growth/felling may change props after the last simulation update.
      observeWorld(); active = false;
    },
    overflow: () => overflow,
    snapshot: () => structuredClone(events)
  };
};
export type ReplaySceneJournal = ReturnType<typeof createReplaySceneJournal>;

/** Apply only recorded scalar prop state, never execute file-provided behavior. */
export const createReplaySceneAdapter = (world: WorldData, events: ReplaySceneEvent[], initialTime = 0) => {
  let cursor = 0, clockRunning = false, clock = initialTime, constructing = false;
  if (events.length > 100000 || JSON.stringify(events).length > 8 * 1024 * 1024)
    throw new Error("Scene observation journal too large");
  const configuration = events[cursor++];
  if (!configuration || !("hooks" in configuration) || !Array.isArray(configuration.hooks) ||
    typeof configuration.unlockAllBuildings !== "boolean" ||
    configuration.hooks.some(hook => !REPLAY_SCENE_HOOKS.includes(hook))) throw new Error("Invalid scene hook configuration");
  for (const event of events) if ("props" in event) {
    if (!Number.isSafeInteger(event.count) || event.count < 0 || event.count > world.cellsX * world.cellsZ * 8 ||
      !Array.isArray(event.props) || event.props.some(row => !Array.isArray(row) || row.length !== 9 ||
        !row.every(Number.isFinite) || !Number.isSafeInteger(row[0]) || row[0]! < 0 || row[0]! >= event.count ||
        !Number.isInteger(row[1]) || row[1]! < 0 || row[1]! > 255 ||
        row[2]! < 0 || row[2]! > world.cellsX || row[4]! < 0 || row[4]! > world.cellsZ || row[5]! < 0))
      throw new Error("Invalid scene prop update");
  }
  const applyWorld = () => {
    for (;;) {
      const event = events[cursor]; if (!event || !("props" in event)) return;
      cursor++;
      markWorldChangedAll(world);
      if (world.props.count !== event.count) resizeProps(world.props, event.count);
      removePropsAt(world, event.props.filter(row => row[1] === 255 && world.props.types[row[0]!] !== 255)
        .map(row => row[0]!));
      const cells = { minX: world.cellsX - 1, minZ: world.cellsZ - 1, maxX: 0, maxZ: 0 };
      for (const row of event.props) {
        const id = row[0]!;
        fields.forEach((field, index) => { world.props[field][id] = row[index + 1]!; });
        const x = Math.min(world.cellsX - 1, Math.floor(world.props.x[id]!));
        const z = Math.min(world.cellsZ - 1, Math.floor(world.props.z[id]!));
        cells.minX = Math.min(cells.minX, x); cells.maxX = Math.max(cells.maxX, x);
        cells.minZ = Math.min(cells.minZ, z); cells.maxZ = Math.max(cells.maxZ, z);
        const cell = z * world.cellsX + x;
        if (isBlockingProp(world.props.types[id]!) && world.blocking[cell] === BLOCKING.free)
          world.blocking[cell] = BLOCKING.prop;
      }
      if (event.props.length) {
        refreshBuildClassRegion(world, expandRegion(world, cells, 2)); refreshWalkCost(world, cells);
      }
      bumpBuildRevision(world, null);
    }
  };
  // Placement checks must follow the captured path, including the explicit development override.
  const hooks: Partial<SettlementOptions> = { unlockAllBuildings: configuration.unlockAllBuildings };
  for (const hook of configuration.hooks) Object.assign(hooks, { [hook]: (...args: unknown[]) => {
    if (hook === "now" && !clockRunning) return clock;
    if (hook === "playerLevel" && constructing) return 0;
    applyWorld();
    const event = events[cursor];
    // A hook absent from the original scene uses the same simulation fallback.
    if (!event || !("hook" in event) || event.hook !== hook)
      throw new Error(`Scene observation order diverged at ${cursor}: ${hook}`);
    if (JSON.stringify(event.args) !== JSON.stringify(observedArgs(hook, args)))
      throw new Error(`Scene observation arguments diverged at ${cursor}: ${hook}`);
    cursor++; const result = structuredClone(restore(event.result));
    if (hook === "now") clock = result as number;
    applyWorld(); return result;
  } });
  /** Simulation construction seeds colony offers from the level before the journal starts; load replaces them. */
  const whileConstructing = <T>(build: () => T): T => {
    constructing = true;
    try { return build(); } finally { constructing = false; }
  };
  return { hooks, afterCommand: applyWorld, whileConstructing, start: () => { clockRunning = true; }, stop: () => { clockRunning = false; },
    beforeUpdate: () => {
    clockRunning = true; applyWorld(); const event = events[cursor++];
    if (!event || !("frame" in event)) throw new Error(`Scene frame boundary diverged at ${cursor - 1}`);
    applyWorld();
  },
    finish: () => { applyWorld(); if (cursor !== events.length) throw new Error(`Unconsumed scene observations: ${events.length - cursor}`); } };
};
