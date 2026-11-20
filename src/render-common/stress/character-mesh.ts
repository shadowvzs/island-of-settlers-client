import { createRandom } from "../../shared/world/rng";
import {
  addBlob,
  addCone,
  MeshBuilder,
  type PropMesh,
  type Vec3,
  type VertexStyle
} from "../props/mesh-builder";
import { addCurvedTube } from "../props/tree-parts";

/** Limb ids of the rig (attribute `rig.x`); `rig.y` is the joint height the limb swings around. */
const LIMB = { body: 0, leftLeg: 1, rightLeg: 2, leftArm: 3, rightArm: 4 } as const;

const HIP = 0.32;
const SHOULDER = 0.56;

export interface CharacterMesh {
  mesh: PropMesh;
  /** Two floats per vertex: limb id, joint height. */
  rig: Float32Array;
}

const solid = (color: Vec3): VertexStyle => ({ color: () => color, flutter: 0 });

/**
 * Placeholder worker facing +x (about 600 triangles): legs and arms are separate tubes so a
 * walk cycle can swing them around hip and shoulder (on the GPU).
 */
export const createCharacterMesh = (): CharacterMesh => {
  const builder = new MeshBuilder();
  const random = createRandom(5);
  const limbs: number[] = [];
  const mark = (limb: number, joint: number, from: number) => {
    for (let vertex = from; vertex < builder.vertexCount; vertex += 1) limbs.push(limb, joint);
  };
  const trousers = solid([0.36, 0.3, 0.24]);
  const shirt = solid([0.85, 0.85, 0.82]);
  const skin = solid([0.93, 0.74, 0.6]);
  for (const [limb, side] of [
    [LIMB.leftLeg, -1],
    [LIMB.rightLeg, 1]
  ] as const) {
    const start = builder.vertexCount;
    addCurvedTube(
      builder,
      [
        [0, HIP, side * 0.06],
        [0, HIP / 2, side * 0.06],
        [0, 0.02, side * 0.06]
      ],
      [0.05, 0.045, 0.04],
      8,
      trousers
    );
    addBlob(
      builder,
      [0.03, 0.02, side * 0.06],
      [0.07, 0.03, 0.045],
      0,
      random,
      solid([0.25, 0.18, 0.12])
    );
    mark(limb, HIP, start);
  }
  const bodyStart = builder.vertexCount;
  addBlob(builder, [0, 0.46, 0], [0.11, 0.16, 0.14], 0.05, random, shirt);
  addBlob(builder, [0, 0.71, 0], [0.085, 0.09, 0.085], 0.04, random, skin);
  addCone(builder, [0, 0.77, 0], 0.11, 0.12, 10, solid([0.55, 0.4, 0.2]));
  mark(LIMB.body, 0, bodyStart);
  for (const [limb, side] of [
    [LIMB.leftArm, -1],
    [LIMB.rightArm, 1]
  ] as const) {
    const start = builder.vertexCount;
    addCurvedTube(
      builder,
      [
        [0, SHOULDER, side * 0.15],
        [0.01, 0.45, side * 0.16],
        [0.02, 0.34, side * 0.15]
      ],
      [0.035, 0.032, 0.03],
      8,
      shirt
    );
    addBlob(builder, [0.02, 0.32, side * 0.15], [0.035, 0.035, 0.035], 0, random, skin);
    mark(limb, SHOULDER, start);
  }
  return { mesh: builder.finish(), rig: Float32Array.from(limbs) };
};
