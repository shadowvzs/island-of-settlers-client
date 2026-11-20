import { Group, Mesh, MeshStandardMaterial, Object3D, TorusGeometry, Vector3, type WebGLRenderer } from "three";

import { HORSE_WORLD_SCALE } from "../../../render-common/mounts/horse-dimensions";
import type { WorkerFrame } from "../../../render-common/workers/worker-unit";
import type { TransportHorseFrame } from "../../../shared/settlement/settlement-horses";
import { meshMaterials } from "../three-mesh-resources";
import {
  attachTransportHorse, disposeTransportHorse, type TransportHorseSpecification, updateTransportHorse
} from "./transport-horse-model";

const HORSE_SPECIFICATION: TransportHorseSpecification =
  { clip: "idle", heading: 0, position: [0, 0, 0], scale: HORSE_WORLD_SCALE };

/** The commanders' visible horses (waiting beside a dismounted rider, led off a landing ship). */
export const createThreeTransportHorses = (
  renderer: WebGLRenderer, bridgeHeight?: (x: number, z: number) => number | undefined
) => {
  const root = new Group(); root.name = "transport_horses";
  const animals = new Map<number, { root: Group }>();
  const update = (frames: readonly TransportHorseFrame[], time: number) => {
    for (const frame of frames) {
      let animal = animals.get(frame.id);
      if (!animal) {
        if (frame.visible === false) continue;
        const unit = new Group(); unit.name = `transport_horse_${frame.id}`;
        unit.userData.transportHorse = HORSE_SPECIFICATION;
        animal = { root: unit }; animals.set(frame.id, animal); root.add(unit);
        void attachTransportHorse(unit, renderer).catch((error) => console.error("Transport horse asset", error));
      }
      animal.root.visible = frame.visible !== false;
      animal.root.position.set(frame.x, bridgeHeight?.(frame.x, frame.z) ?? frame.y, frame.z);
      animal.root.rotation.y = frame.heading;
      updateTransportHorse(animal.root, frame.moving ? frame.walkTime ?? time : time, frame.moving ? "walk" : "idle");
      const head = animal.root.getObjectByName("Head");
      if (head && frame.leader !== undefined && !head.getObjectByName("horse_halter")) {
        const halter = new Group(); halter.name = "horse_halter";
        const material = new MeshStandardMaterial({color:0x68482c,roughness:.95});
        const nose = new Mesh(new TorusGeometry(.082,.009,4,12), material);
        nose.position.set(0,-.12,.2); nose.scale.y=.8; nose.userData.ownedMaterial=true;
        const poll = new Mesh(new TorusGeometry(.095,.007,4,12),material.clone());
        poll.position.set(0,-.025,.02); poll.rotation.y=Math.PI/2;poll.scale.x=1.5;poll.userData.ownedMaterial=true;
        const attachment = new Object3D(); attachment.name="horse_lead_attachment";
        attachment.position.set(-.082,-.12,.2); // Right-side noseband rim, same side as the leader's right hand.
        halter.add(nose,poll,attachment);head.add(halter);
      }
      const halter = head?.getObjectByName("horse_halter");
      if (halter) halter.visible=frame.leader!==undefined;
    }
  };
  const dispose = () => {
    for (const animal of animals.values()) {
      animal.root.userData.disposed = true; disposeTransportHorse(animal.root);
      animal.root.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.geometry.dispose();
        if (object.userData.ownedMaterial)
          meshMaterials(object).forEach((material) => material.dispose());
      });
    }
    animals.clear(); root.removeFromParent();
  };
  const updateLeadTargets = (frames: readonly WorkerFrame[]) => {
    for (const frame of frames) {
      if (!frame.horseLead) continue;
      const attachment = animals.get(frame.horseLead.horseId)?.root.getObjectByName("horse_lead_attachment");
      if (!attachment) { frame.horseLead.target=undefined; continue; }
      const point = attachment.getWorldPosition(new Vector3());
      frame.horseLead.target = {x:point.x,y:point.y,z:point.z};
    }
  };
  return { root, update, updateLeadTargets, dispose };
};
