import { ThreeWorkerPack } from "@workers/game-three-worker";
import { Box3, Mesh, type Object3D, Triangle, Vector3 } from "three";

import { getBuildingStockContact } from "../../src/render-common/buildings/building-stock-anchors";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import type { WorkerFrame } from "../../src/render-common/workers/worker-unit";
import { createWorkerPoser, createWorkerTextureLoader } from "../../src/renderers/three/three-worker";
import { createWorkerProp } from "../../src/renderers/three/three-worker-prop";
import { workerTransferMaterialAction } from "../../src/renderers/three/worker-transfer-pose";
import { BuildingType } from "../../src/shared/settlement/building-type-ids";

const modes = [{ kind: "input", ware: "hides", direction: "pickup", job: "Tanner" },
  { kind: "input", ware: "hides", direction: "putdown", job: "Carrier" },
  { kind: "output", ware: "leather", direction: "pickup", job: "Carrier" },
  { kind: "output", ware: "leather", direction: "putdown", job: "Tanner" }] as const;

export const nearestSurface = (root: Object3D, point: Vector3) => {
  let distance = Infinity;
  const triangle = new Triangle(), nearest = new Vector3();
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute("position"), index = object.geometry.index;
    const count = index?.count ?? position.count;
    const vertex = (at: number, target: Vector3) => target.fromBufferAttribute(position,
      index ? index.getX(at) : at).applyMatrix4(object.matrixWorld);
    for (let at = 0; at < count; at += 3) {
      vertex(at, triangle.a); vertex(at + 1, triangle.b); vertex(at + 2, triangle.c);
      triangle.closestPointToPoint(point, nearest); distance = Math.min(distance, nearest.distanceTo(point));
    }
  });
  return distance;
};

/** Production model/poser/prop/hand IK at canonical Tannery contacts; no authored review poses. */
export const createTanneryTransferFixture = (preview: any, assetRoot: string, minimal: boolean) => {
  const originalNow = performance.now.bind(performance); let clock = originalNow();
  Object.defineProperty(performance, "now", { configurable: true, value: () => clock });
  const textures = createWorkerTextureLoader(preview.renderer);
  const workers = new ThreeWorkerPack(new URL(`/@fs${assetRoot}/tripo/`, location.href).href, textures, minimal);
  return {
    async capture(variant: string) {
      const worker = await workers.load("chinese", variant);
      worker.root.scale.setScalar(WORKER_SCALE); preview.scene.add(worker.root);
      const pose = createWorkerPoser(worker), prop = createWorkerProp(workers, worker, !minimal);
      const joints = new Map<string, Object3D>();
      worker.root.traverse(object => joints.set(object.name, object));
      const bone = (suffix: string) => [...joints.values()].find(object =>
        object.name.replace(/[^a-z]/gi, "").endsWith(suffix))!;
      const point = (suffix: string) => bone(suffix).getWorldPosition(new Vector3());
      const sheets = [document.createElement("canvas"), document.createElement("canvas")];
      for (const sheet of sheets) { sheet.width = 1600; sheet.height = 1920; }
      const records = [];
      const renderCell = (row: number, column: number, label: string, frame: WorkerFrame, targetY: number,
        palms: readonly { position: number[] }[]) => {
        const { heading, x, y, z } = frame;
        const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
        const right = new Vector3(forward.z, 0, -forward.x);
        for (const [view, sheet] of sheets.entries()) {
          const camera = preview.camera, focus = new Vector3(x, y + .65, z).addScaledVector(forward, .18);
          const distance = view === 0 ? 2.8 : .95;
          if (view === 1) focus.y = (targetY + palms[0]!.position[1]! + palms[1]!.position[1]!) / 3;
          camera.position.copy(focus).addScaledVector(right, distance).addScaledVector(forward, -.5);
          camera.position.y += view === 0 ? .35 : .12;
          camera.lookAt(focus); camera.updateMatrixWorld(true); preview.renderer.render(preview.scene, camera);
          const context = sheet.getContext("2d")!;
          context.drawImage(preview.renderer.domElement, column * 320, row * 320, 320, 320);
          context.fillStyle = "#ffffff"; context.font = "13px sans-serif";
          context.fillText(label, column * 320 + 4, row * 320 + 16);
        }
      };
      try {
        for (const [row, mode] of modes.entries()) {
          const contact = getBuildingStockContact(BuildingType.Tannery, mode.kind, mode.ware, 0,
            0, 0, 0, 0, undefined, undefined, { nation: "chinese" })!;
          const [x, y, z] = contact.approach, target = contact.warePosition;
          const heading = Math.atan2(target[0] - x, target[2] - z);
          worker.root.position.set(x, y, z); worker.root.rotation.y = heading;
          const base: WorkerFrame = { actorId: 1, nation: "chinese", variant, x, y, z, heading,
            visible: true, selected: false, action: "idle_breathe", animationTime: 0,
            gaitPhase: 0, runBlend: 0, target: null, carryingWare: null, workerJob: mode.job };
          clock += 1000; pose(base); worker.root.updateMatrixWorld(true);
          const idleHip = point("Hips").y;
          for (let step = 0; step <= 20; step++) {
            const progress = step / 20;
            const carryScale = mode.ware === "hides" && mode.direction === "putdown"
              ? [WORKER_SCALE, WORKER_SCALE, WORKER_SCALE] : contact.wareScale;
            const frame: WorkerFrame = { ...base, action: mode.direction === "pickup" ? "pickup_material" : "putdown_material",
              carriedWareScale: { x: carryScale[0]!, y: carryScale[1]!, z: carryScale[2]! },
              carryingWare: mode.direction === "putdown" ? mode.ware : null,
              wareTransfer: { direction: mode.direction, ware: mode.ware, progress, presentation: contact.presentation,
                target: { x: target[0], y: target[1], z: target[2] }, yaw: contact.wareYaw,
                scale: contact.scale, scale3: { x: contact.wareScale[0], y: contact.wareScale[1], z: contact.wareScale[2] } } };
            clock += 50; pose(frame); prop.update(frame);
            if (step === 0) await new Promise(resolve => requestAnimationFrame(resolve));
            worker.root.updateMatrixWorld(true);
            const held = worker.root.getObjectByName(`ware_${mode.ware}`);
            if (!held?.visible) throw new Error(`${variant}/${mode.ware}: actual transferred prop missing`);
            const knees = ["Left", "Right"].map(side => {
              const hip = point(`${side}UpLeg`), knee = point(`${side}Leg`), foot = point(`${side}Foot`);
              return Math.PI - hip.sub(knee).angleTo(foot.sub(knee));
            });
            const palms = ["L", "R"].map(side => {
              const socket = joints.get(`socket_hand_${side}`)!;
              const palm = socket.getWorldPosition(new Vector3());
              return { side, position: palm.toArray(), surfaceDistance: nearestSurface(held, palm) };
            });
            const bounds = new Box3().setFromObject(held);
            records.push({ ...mode, progress, materialAction: workerTransferMaterialAction(frame),
              target: frame.wareTransfer!.target, targetScale: contact.wareScale,
              hipHeight: point("Hips").y - y, hipDropFromIdle: idleHip - point("Hips").y,
              knees, palms, propBounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } });
            if (step % 5 !== 0) continue;
            preview.model().update(progress, { construction: 1, door: 0, working: false,
              inputStock: {}, outputStock: {} });
            renderCell(row, step / 5, `${variant} ${mode.ware}/${mode.direction} ${progress.toFixed(2)}`,
              frame, target[1], palms);
          }
        }
        for (const [index, ware] of ["hides", "leather"].entries()) {
          const contact = getBuildingStockContact(BuildingType.Tannery, ware === "hides" ? "input" : "output",
            ware, 0, 0, 0, 0, 0, undefined, undefined, { nation: "chinese" })!;
          const heading = Math.atan2(contact.stock[0] - contact.approach[0], contact.stock[2] - contact.approach[2]);
          const x = contact.approach[0] - Math.sin(heading) * .75, y = contact.approach[1];
          const z = contact.approach[2] - Math.cos(heading) * .75;
          const scale = ware === "hides" ? contact.scale : WORKER_SCALE;
          const frame: WorkerFrame = { actorId: 1, nation: "chinese", variant, x, y, z, heading,
            action: "carry_back", visible: true, selected: false, animationTime: 0, gaitPhase: 0, runBlend: 0,
            target: null, carryingWare: ware, carriedWareScale: { x: scale, y: scale, z: scale }, workerJob: "Carrier" };
          worker.root.position.set(x, y, z); worker.root.rotation.y = heading;
          for (let warm = 0; warm < 2; warm++) { clock += 1000; pose({ ...frame, standingCarry: true }); prop.update(frame); }
          for (let step = 0; step <= 20; step++) {
            frame.gaitPhase = step / 20; clock += 50; pose(frame); prop.update(frame); worker.root.updateMatrixWorld(true);
            const held = worker.root.getObjectByName(`ware_${ware}`)!;
            const palms = ["L", "R"].map(side => {
              const palm = joints.get(`socket_hand_${side}`)!.getWorldPosition(new Vector3());
              return { side, position: palm.toArray(), surfaceDistance: nearestSurface(held, palm) };
            });
            records.push({ kind: "carry", direction: "walk", ware, progress: step / 20, palms });
            if (step % 5) continue;
            renderCell(4 + index, step / 5, `${variant} ${ware}/walk ${frame.gaitPhase.toFixed(2)}`,
              frame, held.getWorldPosition(new Vector3()).y, palms);
          }
        }
        return { records, images: sheets.map((sheet, index) => ({ name: index === 0 ? "body" : "hands",
          png: sheet.toDataURL("image/png").split(",")[1]! })) };
      } finally { prop.dispose(); worker.dispose(); worker.root.removeFromParent(); }
    },
    dispose() { Object.defineProperty(performance, "now", { configurable: true, value: originalNow }); }
  };
};
