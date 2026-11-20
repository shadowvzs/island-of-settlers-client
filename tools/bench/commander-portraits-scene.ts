/**
 * Browser half of tools/bench/commander-portraits.ts: the actual mounted commander model of each
 * nation, framed around the actual rider's face and national helmet. Horse, standard and ground
 * effects remain outside this portrait; the real mounted model and textures supply the head.
 */
import * as three from "three";

import { computeEnvironment } from "../../src/render-common/environment";
import type { MountFrame } from "../../src/render-common/mounts/mount-frame";
import { NATION_RIDERS } from "../../src/render-common/mounts/nation-riders";
import type { WorkerNation } from "../../src/render-common/workers/worker-unit";
import { createThreeMounts } from "../../src/renderers/three/three-mounts";
import { createWorkerTextureLoader } from "../../src/renderers/three/three-worker";

const NATIONS: readonly WorkerNation[] = ["roman", "viking", "nubian", "japanese"];
const SIZE = 256;
const HEADING = .6;
const DIRECTION = new three.Vector3(.45, .12, 1).normalize();

const belongsTo = (object: three.Object3D, ancestor: three.Object3D) => {
  for (let node: three.Object3D | null = object; node; node = node.parent)
    if (node === ancestor) return true;
  return false;
};

const riderFaceBounds = (rider: three.Object3D) => {
  const bounds = new three.Box3();
  const points: three.Vector3[] = [];
  const point = new three.Vector3();
  const joints = new three.Vector4(), influence = new three.Vector4();
  rider.traverse(object => {
    if (!(object instanceof three.SkinnedMesh)) return;
    const positions = object.geometry.getAttribute("position");
    const indices = object.geometry.getAttribute("skinIndex");
    const weights = object.geometry.getAttribute("skinWeight");
    if (!indices || !weights) return;
    object.skeleton.update();
    const headBones = new Set(object.skeleton.bones.flatMap((bone, index) =>
      /^(Head|HeadTop_End)$/.test(bone.name) ? [index] : []));
    for (let vertex = 0; vertex < positions.count; vertex++) {
      joints.fromBufferAttribute(indices, vertex);
      influence.fromBufferAttribute(weights, vertex);
      let share = 0;
      for (let slot = 0; slot < 4; slot++)
        if (headBones.has(joints.getComponent(slot))) share += influence.getComponent(slot);
      if (share < .5) continue;
      point.fromBufferAttribute(positions, vertex);
      object.applyBoneTransform(vertex, point);
      point.applyMatrix4(object.matrixWorld);
      bounds.expandByPoint(point);
      points.push(point.clone());
    }
  });
  if (bounds.isEmpty()) throw new Error("The actual commander's skinned face is missing");
  return { bounds, points };
};

const frameCommanderHead = (
  scene: three.Scene, camera: three.OrthographicCamera, renderer: three.WebGLRenderer
) => {
  const mount = scene.children.find(child => child.visible && child.getObjectByName("Saddle"));
  const saddle = mount?.getObjectByName("Saddle");
  const rider = saddle?.children.find(child => child.getObjectByName("Head"));
  const head = rider?.getObjectByName("Head");
  if (!rider || !head) throw new Error("The actual commander's rider head is missing");
  const insignia = rider.getObjectByName("commander_insignia");
  if (insignia) insignia.visible = false;
  scene.traverse(object => {
    if (!(object instanceof three.Mesh)) return;
    if (!belongsTo(object, rider) || (!(object instanceof three.SkinnedMesh) && !belongsTo(object, head)))
      object.visible = false;
  });
  scene.updateMatrixWorld(true);
  const { bounds: face, points } = riderFaceBounds(rider);
  const facePoints = points.slice();
  head.traverse(object => {
    if (!(object instanceof three.Mesh) || object instanceof three.SkinnedMesh) return;
    for (let node: three.Object3D | null = object; node; node = node.parent) if (!node.visible) return;
    const positions = object.geometry.getAttribute("position");
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const point = new three.Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(object.matrixWorld);
      if (point.y >= face.min.y - .008) points.push(point);
    }
  });
  const bounds = new three.Box3().setFromPoints(points);
  // Keep the actual face/helmet, clipping torso geometry rather than showing it below wide horns.
  renderer.clippingPlanes = [new three.Plane(new three.Vector3(0, 1, 0), -(face.min.y - .008))];
  const target = bounds.getCenter(new three.Vector3());
  camera.left = camera.bottom = -1;
  camera.right = camera.top = 1;
  camera.position.copy(target).addScaledVector(DIRECTION, 2);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
  for (const vertex of points) {
    const point = vertex.clone().project(camera);
    left = Math.min(left, point.x); right = Math.max(right, point.x);
    bottom = Math.min(bottom, point.y); top = Math.max(top, point.y);
  }
  let faceLeft = Infinity, faceRight = -Infinity, faceBottom = Infinity, faceTop = -Infinity;
  for (const vertex of facePoints) {
    const point = vertex.clone().project(camera);
    faceLeft = Math.min(faceLeft, point.x); faceRight = Math.max(faceRight, point.x);
    faceBottom = Math.min(faceBottom, point.y); faceTop = Math.max(faceTop, point.y);
  }
  // A face-led avatar: large horn/plume tips may crop rather than shrinking the person's face.
  const faceSpan = Math.max(faceRight - faceLeft, faceTop - faceBottom);
  const side = Math.min(Math.max(right - left, top - bottom) * 1.06, faceSpan * 1.5);
  const centreX = (faceLeft + faceRight) / 2;
  camera.left = centreX - side / 2;
  camera.right = centreX + side / 2;
  camera.bottom = faceBottom - side * .025;
  camera.top = camera.bottom + side;
  camera.updateProjectionMatrix();
};

const commanderFrame = (nation: WorkerNation, actorId: number): MountFrame => ({
  actorId, attackProgress: null, auraActive: false, clip: "idle", clipTime: .4, coat: "bay",
  commander: true, faction: 0, heading: HEADING, nation, rider: NATION_RIDERS[nation], selected: false,
  turnRate: 0, x: 0, y: 0, z: 0
});

export const renderCommanderPortraits = async () => {
  const renderer = new three.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE * 2, SIZE * 2);
  renderer.toneMapping = three.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.autoClear = false;
  renderer.setClearColor(0x000000, 0);
  document.body.append(renderer.domElement);
  const textures = createWorkerTextureLoader(renderer);
  const environment = computeEnvironment({ azimuthX: -.6, azimuthZ: .8, elevation: .85 }, 12, 0);
  const mounts = await createThreeMounts(textures, [], true);
  const camera = new three.OrthographicCamera(-1, 1, 1, -1, .01, 10);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const context = canvas.getContext("2d")!;
  context.imageSmoothingQuality = "high";
  const portraits: { name: string; png: string }[] = [];
  for (const nation of NATIONS) {
    const frames = [commanderFrame(nation, NATIONS.indexOf(nation) + 1)];
    await mounts.prepare(frames, environment);
    frameCommanderHead(mounts.scene, camera, renderer);
    renderer.clear();
    mounts.render(renderer, camera);
    context.clearRect(0, 0, SIZE, SIZE);
    context.drawImage(renderer.domElement, 0, 0, SIZE, SIZE);
    portraits.push({ name: nation, png: canvas.toDataURL("image/png").split(",")[1]! });
  }
  mounts.dispose();
  textures.dispose();
  renderer.dispose();
  return portraits;
};
