import { CROWD_JOINTS } from "@workers/character-lods/lod-policy";
import {
  AnimationClip,
  AnimationMixer,
  Bone,
  BoxGeometry,
  BufferAttribute,
  Group,
  Matrix4,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  ShaderLib,
  ShortType,
  Skeleton,
  SkinnedMesh,
  Vector3,
  VectorKeyframeTrack,
  type WebGLProgramParametersWithUniforms
} from "three";
import { describe, expect, it } from "vitest";

import {
  createCrowdBake, CROWD_BAKE_COLUMNS, CROWD_BAKE_QUANTIZATION, crowdBakeTemplate,
crowdBakeTexel,   crowdJointRemap
} from "../src/renderers/three/worker-gpu-bake";
import { CrowdInstancedMaterial } from "../src/renderers/three/worker-gpu-material";
import { CROWD_BAKE_FPS, crowdBakeClips, loadedCrowdClip } from "../src/renderers/three/worker-gpu-pose";

const SPINE = CROWD_JOINTS.indexOf("Spine");
const LEFT_HAND = CROWD_JOINTS.indexOf("LeftHand");
const FINGER = "LeftHandIndex1";

/** A rig of every crowd joint (a chain, offsets along y) plus one finger under the left hand. */
const buildRig = (jointStep = 0.1) => {
  const root = new Group();
  root.name = "worker_root";
  const armature = new Group();
  armature.name = "Armature";
  root.add(armature);
  const bones = CROWD_JOINTS.map(name => {
    const bone = new Bone();
    bone.name = name;
    bone.position.set(0, jointStep, 0);
    return bone;
  });
  bones.forEach((bone, index) => { if (index) bones[index - 1]!.add(bone); });
  const finger = new Bone();
  finger.name = FINGER;
  finger.position.set(0.05, 0, 0);
  bones[LEFT_HAND]!.add(finger);
  armature.add(bones[0]!);
  const skeleton = new Skeleton([...bones, finger]);
  const geometry = new BoxGeometry(0.2, 1, 0.2);
  const count = geometry.getAttribute("position").count;
  const joints = new Uint16Array(count * 4);
  for (let vertex = 0; vertex < count; vertex++) {
    joints[vertex * 4] = SPINE;
    joints[vertex * 4 + 1] = bones.length; // the finger: must fold onto the left hand's row
  }
  geometry.setAttribute("skinIndex", new BufferAttribute(joints, 4));
  geometry.setAttribute("skinWeight", new BufferAttribute(new Float32Array(count * 4).fill(0.25), 4));
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial({ name: "crowd_body" }));
  mesh.position.set(0, 0.3, 0);
  armature.add(mesh);
  mesh.bind(skeleton);
  root.updateMatrixWorld(true);
  return { armature, bones, finger, mesh, root, skeleton };
};

const turn = (angle: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle);
const quaternionTrack = (joint: string, duration: number, from: Quaternion, to: Quaternion) =>
  new QuaternionKeyframeTrack(`${joint}.quaternion`, [0, duration], [...from.toArray(), ...to.toArray()]);
const clip = (name: string, duration: number, spineTurn: number, armTurn: number) => new AnimationClip(name, duration, [
  new VectorKeyframeTrack("Hips.position", [0, duration], [0, 0.1, 0, 0, 0.1 + spineTurn * 0.1, 0]),
  quaternionTrack("Spine", duration, turn(0), turn(spineTurn)),
  quaternionTrack("LeftArm", duration, turn(armTurn), turn(armTurn))
]);
const clips = [clip("walk", 1, 1.2, 0), clip("run", 0.8, 0.8, 0), clip("idle_breathe", 2, 0.1, 0),
  clip("carry_shoulder", 1, 0.4, 0.9), clip("carry_back", 1, 0.4, -0.9), clip("chop_tree", 1.5, 2, 0.5)];

/** The skinning matrix Three would build for `bone` of a mesh bound like `template`. */
const expectedSkin = (rig: ReturnType<typeof buildRig>, bone: Object3D) => {
  const index = rig.skeleton.bones.indexOf(bone as Bone);
  return new Matrix4().multiplyMatrices(rig.mesh.matrixWorld, rig.mesh.bindMatrixInverse)
    .multiply(bone.matrixWorld).multiply(rig.skeleton.boneInverses[index]!).multiply(rig.mesh.bindMatrix);
};

/** Poses a reference rig with the mixer at `time` of `clipName`. */
const poseReference = (clipName: string, time: number) => {
  const rig = buildRig();
  const mixer = new AnimationMixer(rig.root);
  mixer.clipAction(clips.find(entry => entry.name === clipName)!).play();
  mixer.setTime(time);
  rig.root.updateMatrixWorld(true);
  return rig;
};

const readBlock = (data: Float32Array, row: number, joint: number) => {
  const offset = row * CROWD_BAKE_COLUMNS * 4 + joint * 12;
  const matrix = new Matrix4();
  const e = matrix.elements;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) e[c * 4 + r] = data[offset + r * 4 + c]!;
  return matrix;
};

/** The 16-bit fixed-point texels of one joint block, decoded to a Matrix4. */
const readTexelBlock = (texels: Int16Array, row: number, joint: number) => {
  const offset = row * CROWD_BAKE_COLUMNS * 4 + joint * 12;
  const matrix = new Matrix4();
  const e = matrix.elements;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++)
    e[c * 4 + r] = texels[offset + r * 4 + c]! / CROWD_BAKE_QUANTIZATION;
  return matrix;
};

const expectMatrix = (actual: Matrix4, expected: Matrix4, digits = 5) => {
  actual.elements.forEach((value, index) => expect(value).toBeCloseTo(expected.elements[index]!, digits));
};

const bakeAll = () => {
  const template = buildRig();
  const rig = buildRig();
  const bake = createCrowdBake({ clips: crowdBakeClips(clips), rig: rig.root,
    template: crowdBakeTemplate(template.mesh) });
  bake.finish();
  return { bake, template };
};

describe("createCrowdBake", () => {
  it("lays every clip out contiguously and reports ranges only once baked", () => {
    const template = buildRig();
    const bake = createCrowdBake({ clips: crowdBakeClips(clips), rig: buildRig().root,
      template: crowdBakeTemplate(template.mesh) });
    expect(bake.range("walk")).toBeUndefined();
    expect(bake.ready()).toBe(false);
    while (!bake.step(1)) { /* chunked over frames */ }
    expect(bake.ready()).toBe(true);
    expect(bake.isSupported()).toBe(true);
    const walk = bake.range("walk")!;
    expect(walk).toEqual({ duration: 1, frames: CROWD_BAKE_FPS + 1, start: 0 });
    expect(bake.range("run")!.start).toBe(walk.frames);
    expect(bake.range(loadedCrowdClip("carry_back", "stand"))!.frames).toBe(2);
    expect(bake.texture.image.height).toBe([...bake.ranges.values()].reduce((sum, range) => sum + range.frames, 0));
    expect(bake.texture.image.width).toBe(CROWD_JOINTS.length * 3);
    bake.dispose();
  });

  it("stores the skinning matrix of each crowd joint, placement and bind included", () => {
    const { bake, template } = bakeAll();
    const frame = 8;
    const row = bake.range("walk")!.start + frame;
    const reference = poseReference("walk", frame / CROWD_BAKE_FPS);
    expectMatrix(readBlock(bake.data, row, SPINE), expectedSkin(reference, reference.bones[SPINE]!));
    expectMatrix(readBlock(bake.data, row, LEFT_HAND), expectedSkin(reference, reference.bones[LEFT_HAND]!));
    // The placement is part of the matrix: a template mesh at the origin bakes differently.
    expect(template.mesh.position.y).toBe(0.3);
    bake.dispose();
  });

  it("holds the load's upper body over the walking legs in the composite clips", () => {
    const { bake } = bakeAll();
    const frame = 5;
    const walkRow = bake.range("walk")!.start + frame;
    const carryRow = bake.range(loadedCrowdClip("carry_shoulder", "walk"))!.start + frame;
    const hipsRow = CROWD_JOINTS.indexOf("Hips");
    expectMatrix(readBlock(bake.data, carryRow, hipsRow), readBlock(bake.data, walkRow, hipsRow));
    const reference = poseReference("carry_shoulder", 0);
    const armRow = CROWD_JOINTS.indexOf("LeftArm");
    // Hips come from the walk, so compare the arm's own rotation part only (columns 0-2 of row 0-2).
    const baked = readBlock(bake.data, carryRow, armRow), expected = expectedSkin(reference, reference.bones[armRow]!);
    for (const index of [0, 1, 2, 4, 5, 6, 8, 9, 10])
      expect(baked.elements[index]).toBeCloseTo(expected.elements[index]!, 5);
    bake.dispose();
  });

  it("poses an actor's crowd bones back to their world matrices, interpolating rows", () => {
    const { bake } = bakeAll();
    expect(bake.isSupported()).toBe(true);
    const actor = buildRig();
    const rootWorld = new Matrix4().compose(new Vector3(3, 0.5, -2), turn(0.7), new Vector3(0.8, 0.8, 0.8));
    const start = bake.range("walk")!.start;
    const rows = { mix: 0, previousRow: 0, previousWeight: 0, rowA: start + 8, rowB: 0 };
    bake.poseCrowdBones(actor.bones, rootWorld, rows);
    const reference = poseReference("walk", 8 / CROWD_BAKE_FPS);
    for (const joint of [SPINE, LEFT_HAND, CROWD_JOINTS.indexOf("RightToeBase")]) {
      const expected = new Matrix4().multiplyMatrices(rootWorld, reference.bones[joint]!.matrixWorld);
      expectMatrix(actor.bones[joint]!.matrixWorld, expected);
    }
    const atEight = actor.bones[SPINE]!.matrixWorld.clone();
    bake.poseCrowdBones(actor.bones, rootWorld, { ...rows, rowA: start + 9 });
    const atNine = actor.bones[SPINE]!.matrixWorld.clone();
    bake.poseCrowdBones(actor.bones, rootWorld, { ...rows, rowA: start + 8.5 });
    const middle = atEight.clone();
    middle.elements.forEach((value, index) => { middle.elements[index] = (value + atNine.elements[index]!) / 2; });
    expectMatrix(actor.bones[SPINE]!.matrixWorld, middle);
    // A mix towards another row is the same linear blend; a fading previous row too.
    bake.poseCrowdBones(actor.bones, rootWorld, { ...rows, mix: 0.5, rowB: start + 9 });
    expectMatrix(actor.bones[SPINE]!.matrixWorld, middle);
    bake.poseCrowdBones(actor.bones, rootWorld, { ...rows, previousRow: start + 9, previousWeight: 0.5 });
    expectMatrix(actor.bones[SPINE]!.matrixWorld, middle);
    bake.dispose();
  });

  it("stores the GPU bake as 16-bit fixed point within 1 mm of the float32 positions", () => {
    // Human proportions: the 22-joint chain spans ~1.15 model units, like the worker rig.
    const template = buildRig(0.05);
    const bake = createCrowdBake({ clips: crowdBakeClips(clips), rig: buildRig(0.05).root,
      template: crowdBakeTemplate(template.mesh) });
    bake.finish();
    expect(bake.texture.type).toBe(ShortType);
    const texels = bake.texture.image.data as Int16Array;
    expect(texels).toBeInstanceOf(Int16Array);
    expect(texels.length).toBe(bake.data.length);

    const vertices: Vector3[] = [];
    const positions = template.mesh.geometry.getAttribute("position");
    for (let vertex = 0; vertex < positions.count; vertex++)
      vertices.push(new Vector3(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)));
    const floatPosition = new Vector3(), texelPosition = new Vector3();
    let worstError = 0;
    const rows = bake.texture.image.height;
    for (let row = 0; row < rows; row++) {
      for (let joint = 0; joint < CROWD_JOINTS.length; joint++) {
        const floatMatrix = readBlock(bake.data, row, joint);
        const texelMatrix = readTexelBlock(texels, row, joint);
        for (const vertex of vertices) {
          floatPosition.copy(vertex).applyMatrix4(floatMatrix);
          texelPosition.copy(vertex).applyMatrix4(texelMatrix);
          worstError = Math.max(worstError, floatPosition.distanceTo(texelPosition));
        }
      }
    }
    // 1 mm at the crowd LOD: a 1.06 m body at 20 px has ~0.05 mm per pixel, so this is far
    // below a pixel; the quantisation step alone is 1/4096 model unit.
    expect(worstError).toBeLessThan(0.001);
    bake.dispose();
  });

  it("quantises an element with a 1/4096 step and clamps to the int16 range", () => {
    expect(crowdBakeTexel(0.5)).toBe(2048);
    expect(crowdBakeTexel(-0.5)).toBe(-2048);
    expect(crowdBakeTexel(0.0001)).toBe(0);
    expect(crowdBakeTexel(9)).toBe(32767);
    expect(crowdBakeTexel(-9)).toBe(-32768);
  });

  it("maps every skeleton bone to a crowd row, fingers onto their hand", () => {
    const rig = buildRig();
    const remap = crowdJointRemap(rig.skeleton);
    expect(remap.slice(0, CROWD_JOINTS.length)).toEqual(CROWD_JOINTS.map((_, index) => index));
    expect(remap[rig.skeleton.bones.indexOf(rig.finger)]).toBe(LEFT_HAND);
  });
});

describe("CrowdInstancedMaterial", () => {
  it("replaces skeleton skinning with baked-row sampling and per-instance tint", () => {
    const { bake, template } = bakeAll();
    const material = new CrowdInstancedMaterial(template.mesh.material as MeshStandardMaterial, bake.texture);
    const shader = {
      fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {}, vertexShader: ShaderLib.standard.vertexShader
    } as unknown as WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader);
    expect(shader.uniforms.crowdBones?.value).toBe(bake.texture);
    expect(shader.vertexShader).toContain("uniform isampler2D crowdBones;");
    expect(shader.vertexShader).toContain("texelFetch( crowdBones");
    expect(shader.vertexShader).toContain(`* ${1 / CROWD_BAKE_QUANTIZATION}`);
    expect(shader.vertexShader).not.toContain("#include <skinbase_vertex>");
    expect(shader.vertexShader).not.toContain("#include <skinning_vertex>");
    expect(shader.vertexShader).not.toContain("#include <skinnormal_vertex>");
    expect(shader.vertexShader).toContain("attribute vec4 crowdJoint;");
    expect(shader.fragmentShader).toContain("varying vec3 vCrowdTint;");
    expect(shader.fragmentShader).not.toContain("uniform vec3 crowdTint;");
    expect(shader.fragmentShader).toContain("mix( vec3( 1.0 ), vCrowdTint,");
    expect(material.customProgramCacheKey()).toContain("crowd_instanced");
    bake.dispose();
  });
});
