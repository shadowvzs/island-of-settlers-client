import {
  AnimationClip,
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  PlaneGeometry,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector2,
  Vector3,
  VectorKeyframeTrack
} from "three";

import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import { sampleWellWorkCycle, WELL_CYCLE_SECONDS } from "../../../render-common/buildings/well-work-cycle";
import type { WorkerNation } from "../../../render-common/workers/worker-nation";
import { addNationalWellWheel } from "./national-well-wheel";
import { createRomanDrawBucket } from "./roman-draw-bucket";
import { createHollowRingGeometry } from "./roman-hollow-ring";
import { createRomanWaterTextures } from "./roman-water-textures";
import { createWellChain } from "./roman-well-chain";

/** Original 3D mechanism inspired by the lower/crank/raise sequence in nofWellguy. */
/** Only wells with an authored receiving basin get a separate exposed water surface. */
const createBasinWater = (detailed: boolean, nation: WorkerNation, waterMaterial: MeshStandardMaterial) => {
  const waterGeometry = nation === "roman" || nation === "maya"
    ? new PlaneGeometry(0.345, 0.445, detailed ? 10 : 4, detailed ? 10 : 4)
    : new CircleGeometry(1, detailed ? 24 : 10).scale(.345 / 2, .445 / 2, 1);
  waterGeometry.rotateX(-Math.PI / 2);
  const position = waterGeometry.getAttribute("position");
  waterGeometry.morphAttributes.position = [0, Math.PI].map((phase) => {
    const values = new Float32Array(position.array);
    for (let i = 0; i < position.count; i++)
      values[i * 3 + 1] =
        values[i * 3 + 1]! +
        0.004 * Math.sin(position.getX(i) * 35 + position.getZ(i) * 25 + phase);
    return new Float32BufferAttribute(values, 3);
  });
  const water = new Mesh(waterGeometry, waterMaterial);
  water.name = "well_trough_water";
  water.position.set(0.6, -0.65, -0.03);
  return water;
};

export const createRomanWellMechanism = (
  materials: Record<BuildingSurface, MeshStandardMaterial>,
  detailed: boolean, nation: WorkerNation = "roman"
) => {
  const root = new Group();
  root.name = "mechanism";
  // Quarter-turn the complete moving assembly to follow the narrow 1×2 plot.
  root.rotation.y = Math.PI / 2;
  const mesh = (
    geometry: BoxGeometry | CylinderGeometry | ReturnType<typeof createHollowRingGeometry>,
    material: MeshStandardMaterial,
    parent = root
  ) => {
    geometry.setAttribute(
      "color",
      new Float32BufferAttribute(
        new Float32Array(geometry.attributes.position!.count * 3).fill(1),
        3
      )
    );
    const object = new Mesh(geometry, material);
    object.castShadow = detailed;
    parent.add(object);
    return object;
  };
  const wheel = new Group();
  wheel.name = "well_windlass";
  wheel.position.set(-0.56, 0, -0.06);
  root.add(wheel);
  const axle = mesh(
    new CylinderGeometry(0.045, 0.045, 1.17, detailed ? 12 : 6),
    materials.wood,
    wheel
  );
  axle.rotation.z = Math.PI / 2;
  axle.position.x = 0.56;
  if (nation === "roman") {
    for (let i = 0; i < 8; i++) {
      const spoke = mesh(new BoxGeometry(0.045, 0.43, 0.035), materials.wood, wheel);
      spoke.rotation.x = (i * Math.PI) / 4;
    }
  } else addNationalWellWheel(wheel, materials, detailed, nation);
  const crank = mesh(new BoxGeometry(0.13, 0.035, 0.035), materials.wood, wheel);
  crank.name = "well_crank_handle";
  crank.position.set(-0.075, 0.18, 0);
  const chain = nation === "roman" || nation === "persian"
    ? createWellChain(materials.steel, wheel, detailed)
    : createWellChain(materials.rope, wheel, false);
  root.add(chain.root);
  const waterTextures = createRomanWaterTextures(detailed);
  const waterMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    map: waterTextures.map,
    normalMap: waterTextures.normalMap,
    normalScale: new Vector2(1, -1),
    roughness: 0.2,
    metalness: 0.08,
    transparent: true,
    opacity: 0.82
  });
  const water = nation === "indigenous" ? undefined : createBasinWater(detailed, nation, waterMaterial);
  if (water) root.add(water);
  const { root: bucket, water: bucketWater } = createRomanDrawBucket(materials, waterMaterial, detailed, false, nation);
  root.add(bucket);
  const fillTrack = new VectorKeyframeTrack(
    "well_bucket_water.scale",
    [0, 11.9, 12, 13.999, 14],
    [0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 1, 1, 1, 1, 1, 1, 0.001, 0.001, 0.001]
  );
  const times = [0, 1, 2, 12, 13, 14];
  const heights = [-0.24, -0.24, -0.69, -0.69, -0.24, -0.24];
  const bucketTrack = new VectorKeyframeTrack(
    "well_bucket.position",
    times,
    heights.flatMap((y) => [0, y, -0.06])
  );
  const wheelTimes = Array.from({ length: 57 }, (_, i) => i / 4);
  const wheelAngles = wheelTimes.map(time => sampleWellWorkCycle(time).angle);
  const wheelTrack = new QuaternionKeyframeTrack(
    "well_windlass.quaternion",
    wheelTimes,
    wheelAngles.flatMap((angle) =>
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle).toArray()
    )
  );
  const rippleTracks = (water ? [0, 1] : []).map(
    (index) =>
      new NumberKeyframeTrack(
        `well_trough_water.morphTargetInfluences[${index}]`,
        [0, 3.5, 7, 10.5, 14],
        index === 0 ? [0, 1, 0, 1, 0] : [1, 0, 1, 0, 1]
      )
  );
  const clip = new AnimationClip("working", WELL_CYCLE_SECONDS, [
    bucketTrack,
    fillTrack,
    ...chain.tracks,
    wheelTrack,
    ...rippleTracks
  ]);
  const update = (elapsed: number, time: number, holdRaised = false, bucketTaken = false, _working = true) => {
    const { angle, filled, height: y } = sampleWellWorkCycle(elapsed, holdRaised);
    bucket.visible = !bucketTaken;
    bucket.position.set(0, y, -0.06);
    const length = Math.max(0.01, -y - 0.195);
    chain.update(length);
    wheel.rotation.x = angle;
    bucketWater.scale.setScalar(filled ? 1 : 0.001);
    if (water) {
      water.morphTargetInfluences![0] = 0.5 + Math.sin(time * 2) * 0.5;
      water.morphTargetInfluences![1] = 0.5 - Math.sin(time * 2) * 0.5;
    }
  };
  update(0, 0);
  return {
    root,
    clip,
    update,
    dispose: () => {
      waterMaterial.dispose();
      waterTextures.dispose();
    }
  };
};
