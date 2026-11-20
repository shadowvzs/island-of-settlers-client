import type { ShipFrame } from "../render-common/ships/ship-frame";
import type { WorkerFrame } from "../render-common/workers/worker-unit";
import { actorIncarnation } from "../shared/settlement/actor-incarnation";
import type { SettlementActor } from "../shared/settlement/settlement-types";
import type { UnitDecisionReasonCode } from "../shared/settlement/unit-decision-diagnostics";
import type { ObservationRoute, ObservationSubject } from "./camera-follow";

const activity = (actor: SettlementActor) => {
  if (actor.visible === false) return "Inside a building";
  if (actor.ware) return "Carrying cargo";
  if (actor.action === "work") return "Working";
  if (actor.action === "walk") return "Walking";
  return "Resting or waiting";
};

export const observeActor = (
  actor: SettlementActor, reason?: () => UnitDecisionReasonCode | undefined
): (() => ObservationSubject | null) => {
  const route = () => ({ points: actor.path, index: actor.pathIndex });
  return () =>
    actor.phase === "retired"
      ? null
      : {
          identity: actorIncarnation(actor),
          label: actor.job,
          detail: activity(actor),
          x: actor.x,
          y: actor.y,
          z: actor.z,
          ...(reason ? { reason } : {}),
          route
        };
};

const shipActivity: Record<string, string> = {
  idle: "Waiting at home",
  positioning: "Positioning",
  loading: "Loading",
  unloading: "Unloading",
  sailing: "At sea",
  returning: "Returning home",
  stranded: "Waiting for a clear sea route"
};

/** Uses the existing render frame stream rather than rebuilding fleet/cargo snapshots each frame. */
export const observeShip = (id: string, name: string, frames: () => readonly ShipFrame[],
  route?: (id: number) => ObservationRoute | null | undefined) => {
  const identity = {};
  return (): ObservationSubject | null => {
    const ship = frames().find((ship) => String(ship.id) === id);
    if (!ship || ship.phase === "away" || ship.livery === "enemy") return null;
    return {
      identity,
      shipId: id,
      label: name,
      detail: shipActivity[ship.phase] ?? "Travelling",
      x: ship.x,
      y: ship.y,
      z: ship.z,
      ...(route ? { route: () => {
        const view = route(Number(id));
        return view ? { ...view, surfaceY: ship.y } : null;
      } } : {})
    };
  };
};

export const observeSandboxWorker = (frame: WorkerFrame, identity: object) => () => ({
  identity,
  label: "Worker",
  detail: "Exploring",
  x: frame.x,
  y: frame.y,
  z: frame.z
});
