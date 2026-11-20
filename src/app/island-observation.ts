import type { CameraState } from "../render-common/camera-state";
import type { TerrainRenderer } from "../render-common/renderer-contract";
import type { ShipFrame } from "../render-common/ships/ship-frame";
import type { createWorkerGroup } from "../render-common/workers/worker-group";
import { sampleSmooth } from "../shared/world/grid-geometry";
import type { WorldData } from "../shared/world/world-data";
import { createObservationPanel } from "./observation/observation-panel";
import { observeActor, observeSandboxWorker, observeShip } from "./observation-subjects";
import type { IslandSettlement } from "./settlement/island-settlement";
import { createShipObservation } from "./ship-observation";
import { pickWorkerAt } from "./worker-selection";

/** Ship frames of the last rendered settlement frame; the render loop replaces `ships` each frame. */
export interface ObservedShips {
  ships: readonly ShipFrame[];
}

interface IslandObservationOptions {
  camera: CameraState;
  canvas: HTMLCanvasElement;
  getSettlement: () => IslandSettlement | undefined;
  observed: ObservedShips;
  renderer: TerrainRenderer;
  viewport: HTMLElement;
  workers: ReturnType<typeof createWorkerGroup>;
  world: WorldData;
}

/** Observation panel (follow a worker or ship) and the ship windows' follow controls. */
export const createIslandObservation = (options: IslandObservationOptions) => {
  const { camera, canvas, getSettlement, observed, renderer, viewport, workers, world } = options;
  const observation = createObservationPanel({
    camera, canvas, mapSize: [world.cellsX, world.cellsZ], renderer, viewport,
    height: (x, z) => sampleSmooth(world, world.heights, x, z),
    pickWorker: (x, y) => {
      const settlement = getSettlement();
      const frames = settlement?.workerFrames ?? workers.frames;
      const eligible = frames.filter(frame => frame.visible !== false && frame.workerJob !== "Soldier" &&
        !frame.combat?.faction);
      const frame = eligible[pickWorkerAt(renderer, eligible, x, y)];
      if (!frame) return null;
      if (!settlement) {
        const unit = workers.units.find(unit => unit.frame === frame);
        if (!unit) return null;
        return observeSandboxWorker(frame, unit);
      }
      const actor = settlement.simulation.frames().find(actor => actor.uid === frame.actorId);
      if (!actor || actor.job === "Soldier") return null;
      return observeActor(actor, () => settlement.simulation.unitDiagnostics(actor.uid)?.reason);
    },
    pickShip: id => {
      const name = getSettlement()?.simulation.ships().find(ship => String(ship.id) === id)?.name ?? "Ship";
      return observeShip(id, name, () => observed.ships, shipId => getSettlement()?.simulation.shipRoute(shipId));
    }
  });
  const shipObservation = createShipObservation({
    follower: observation.follower,
    follow: observation.followShip, frames: () => observed.ships,
    name: id => getSettlement()?.simulation.ships().find(ship => String(ship.id) === id)?.name ?? "Ship",
    route: id => getSettlement()?.simulation.shipRoute(id)
  });
  return { observation, shipObservation };
};
