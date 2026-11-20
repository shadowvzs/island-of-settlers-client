import type { WorldData } from "../../shared/world/world-data";

/**
 * The monotonic world revisions an editor worker build reads. A rebuild may only install while
 * these still describe the live world: any later edit bumps at least one of them.
 */
export interface EditRevision {
  /** Building state, props blocking and every build-layer refresh (`buildRevision`). */
  build: number;
  /** Prop list length: props move colliders and rock clearance even without a build refresh. */
  props: number;
  /** Derived terrain and water state (`terrainRevision`). */
  terrain: number;
}

/** A worker result and the exact revision it was computed from. */
export interface TaggedEditResult<T> {
  revision: EditRevision;
  value: T;
}

/** The current island revision (cheap counters, not a content hash). */
export const getEditRevision = (
  world: Pick<WorldData, "buildRevision" | "props" | "terrainRevision">
): EditRevision => ({
  build: world.buildRevision ?? 0,
  props: world.props.count,
  terrain: world.terrainRevision ?? 0
});

/** Whether two snapshots describe the same world revision (all counters are monotonic). */
export const sameEditRevision = (first: EditRevision, second: EditRevision) =>
  first.build === second.build &&
  first.props === second.props &&
  first.terrain === second.terrain;
