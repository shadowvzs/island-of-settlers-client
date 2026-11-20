import type { RoadDecorationItemId } from "../../../../island-of-settlers-shared/src/road-decoration-items";
import type { WorldData } from "../world/world-data";
import { createAuthoredDecorationState, toAuthoredDecorationSave } from "./authored-decorations";
import { createScenarioInspectionContext } from "./settlement-map-scenario";

/**
 * The editor's view of the authored decorations: the shared authored owner (see `authored-decorations`)
 * on the scenario's scratch inspection context. A refused row stays in the map data and is reported by
 * index (its later edits may make it valid again).
 */
export const createScenarioDecorationLayout = (world: WorldData) => {
  const state = createAuthoredDecorationState(createScenarioInspectionContext(world));
  state.load(toAuthoredDecorationSave(world.scenario?.decorations ?? []));
  return {
    /** Indexes (into `scenario.decorations`) of rows the placement rules refuse. */
    blocked: () => state.returns().map(row => row.source - 1),
    /** Centres of the accepted rows near a point (ground decoration props keep their spacing to them). */
    centresNear: (point: { x: number; z: number }) => state.framesNear({ max: [point.x + 1, 0, point.z + 1],
      min: [point.x - 1, 0, point.z - 1] }).map(frame => ({ x: frame.position[0], z: frame.position[2] })),
    frames: state.frames,
    plan: (item: RoadDecorationItemId, point: { x: number; z: number }, yaw: number) =>
      state.plan({ item, position: point, yaw })
  };
};

export type ScenarioDecorationLayout = ReturnType<typeof createScenarioDecorationLayout>;
