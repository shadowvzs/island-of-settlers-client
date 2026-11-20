import { ThreeWorkerPack } from "@workers/game-three-worker";
import { Group, Vector3 } from "three";
import type { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";

import { HANDCART } from "../../../render-common/logistics/handcart-rules";
import { WORKER_ASSET_BASE } from "../../../render-common/workers/worker-assets";
import { WORKER_SCALE } from "../../../render-common/workers/worker-dimensions";
import type { WorkerFrame } from "../../../render-common/workers/worker-unit";
import { createWorkerPoser } from "../three-worker";
import { createWorkerHandcartGrip } from "../worker-handcart-grip";
import { createRomanHandcart } from "./roman-handcart";

/** Explicit visual prototype only: no stock debit, anonymous NPC or automatic carrier replacement. */
export const createHandcartPrototype = async (textures: KTX2Loader, detailed: boolean) => {
  const pack = new ThreeWorkerPack(new URL("tripo/", WORKER_ASSET_BASE).href, textures);
  const worker = await pack.load("roman", "roman-man-white");
  const cart = createRomanHandcart(detailed);
  const root = new Group(); root.name = "handcart_single_unit_prototype";
  root.add(cart.root, worker.root);
  worker.root.scale.setScalar(WORKER_SCALE); worker.root.position.z = HANDCART.carrierOffset;
  const pose = createWorkerPoser(worker), grip = createWorkerHandcartGrip(worker.root);
  let phase = 0, idleTime = 0;
  const previous = new Vector3();
  let placed = false;
  const frame = { nation: "roman", variant: "roman-man-white", action: "idle_breathe",
    animationTime: 0, gaitPhase: 0, runBlend: 0, heading: 0, x: 0, y: 0, z: 0,
    target: null, selected: false, carryingWare: null, workerJob: "Carrier" } as WorkerFrame;
  const update = (x: number, y: number, z: number, heading: number, seconds: number) => {
    const point = new Vector3(x, y, z);
    const distance = placed ? point.clone().sub(previous).setY(0).length() : 0;
    previous.copy(point); placed = true;
    root.position.copy(point); root.rotation.y = heading;
    const moving = distance > .00001;
    phase = (phase + distance / (.75 * WORKER_SCALE)) % 1;
    idleTime += seconds;
    frame.action = moving ? "walk" : "idle_breathe";
    frame.gaitPhase = phase; frame.animationTime = moving ? phase : idleTime;
    grip.reset(); pose(frame); grip.apply(cart.root); cart.advance(distance);
  };
  update(0, 0, 0, 0, 0);
  return { root, update, setLoad: cart.setLoad, triangles: cart.triangles,
    contactError: () => grip.contactError(cart.root),
    dispose: () => { grip.reset(); cart.dispose(); worker.dispose(); pack.dispose(); root.removeFromParent(); }
  };
};
