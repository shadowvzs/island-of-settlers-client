import { Matrix4, type Mesh, Vector3 } from "three";

import { TROOP_GANGWAY_SITE_ID_OFFSET } from "../../../shared/settlement/constants";
import type { ShipWorkpoint } from "../../../shared/settlement/settlement-ship-workpoint";

/** Visual only: seconds a troop ship's gangway takes to run out to the shore, or back in when it sails. */
const GANGWAY_RUN_SECONDS = .7;
/** The run never starts from a zero-length board (a degenerate matrix). */
const MINIMUM_EXTENSION = .02;

/** Troop gangway site ids run from their offset up to the harbour piers' block (2,000,000). */
const TROOP_GANGWAY_SITE_ID_END = 2_000_000;

/** An anchored troop ship's gangway (it runs out and back in), not a harbour dock or a shipwright's ramp. */
export const isTroopGangwaySite = (id: number) => id >= TROOP_GANGWAY_SITE_ID_OFFSET && id < TROOP_GANGWAY_SITE_ID_END;

/** A gangway running out from the hull (`deployed` set) or back in (`retracted` set), by render time. */
export interface GangwayRun {
  deployed?: number;
  /** Hull contact to shore foot, on the ground plane. */
  direction: Vector3;
  mesh: Mesh;
  pivot: Vector3;
  retracted?: number;
}

const scratch = { along: new Matrix4(), basis: new Matrix4(), inverse: new Matrix4() };

/** Starts a deploy: the board grows from the hull contact towards the shore foot. */
export const startGangwayRun = (mesh: Mesh, work: ShipWorkpoint, time: number): GangwayRun => {
  const pivot = new Vector3(work.contact.x, work.y, work.contact.z);
  const direction = new Vector3(work.shore.x - work.contact.x, 0, work.shore.z - work.contact.z);
  if (direction.lengthSq() < 1e-8) direction.set(1, 0, 0);
  direction.normalize();
  mesh.matrixAutoUpdate = false;
  return { deployed: time, direction, mesh, pivot };
};

/** The share of the board out at `time` (1: fully out). */
const extensionAt = (run: GangwayRun, time: number) => {
  const elapsed = (time - (run.retracted ?? run.deployed ?? time)) / GANGWAY_RUN_SECONDS;
  const share = Math.min(1, Math.max(0, elapsed));
  const eased = share * share * (3 - 2 * share);
  return run.retracted === undefined ? eased : 1 - eased;
};

/** Scales the mesh along the gangway line about the hull contact (pivot) by `extension`. */
const applyExtension = (run: GangwayRun, extension: number) => {
  const { direction, mesh, pivot } = run;
  const side = new Vector3(-direction.z, 0, direction.x);
  scratch.basis.makeBasis(direction, new Vector3(0, 1, 0), side);
  scratch.inverse.copy(scratch.basis).invert();
  scratch.along.makeScale(Math.max(MINIMUM_EXTENSION, extension), 1, 1);
  mesh.matrix.makeTranslation(pivot.x, pivot.y, pivot.z).multiply(scratch.basis).multiply(scratch.along)
    .multiply(scratch.inverse).multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  mesh.matrixWorldNeedsUpdate = true;
};

/**
 * Advances one run. Returns "running" while it moves, "out" once a deploy is complete (the mesh keeps the
 * identity pose) and "in" once a retraction is complete (the caller disposes the mesh).
 */
export const advanceGangwayRun = (run: GangwayRun, time: number): "in" | "out" | "running" => {
  const extension = extensionAt(run, time);
  if (run.retracted !== undefined && extension <= 0) return "in";
  if (run.retracted === undefined && extension >= 1) {
    run.mesh.matrix.identity();
    run.mesh.matrixWorldNeedsUpdate = true;
    return "out";
  }
  applyExtension(run, extension);
  return "running";
};
