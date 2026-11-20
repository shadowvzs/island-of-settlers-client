import { BoxGeometry, InstancedMesh, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene } from "three";
import { describe, expect, it } from "vitest";

import { prewarmPipelines } from "../src/renderers/three/webgpu/pipeline-prewarm";

type PrewarmRenderer = Parameters<typeof prewarmPipelines>[0];

/** Records the objects a compile would see: on the camera layers and shown. */
const recordingRenderer = (compiled: Set<string>) => ({
  compileAsync: async (scene: Scene) => {
    scene.traverse(object => {
      if (object.layers.mask !== 0 && object.visible && object.name) compiled.add(object.name);
    });
  }
}) as unknown as PrewarmRenderer;

const named = <T extends { name: string }>(object: T, name: string) => {
  object.name = name;
  return object;
};

describe("webgpu pipeline prewarm", () => {
  it("compiles mirrored copies and opted-in instanced pools as their own representatives", async () => {
    const geometry = new BoxGeometry(), material = new MeshStandardMaterial();
    const scene = new Scene();
    const left = named(new Mesh(geometry, material), "left");
    const twin = named(new Mesh(geometry, material), "twin");
    const right = named(new Mesh(geometry, material), "right");
    right.scale.x = -1;
    const pools = [0, 1, 2, 3].map(index => {
      const pool = named(new InstancedMesh(geometry, material, 4), `pool${index}`);
      pool.count = 0;
      pool.userData.prewarmOwnPipeline = index < 2;
      return pool;
    });
    scene.add(left, twin, right, ...pools);
    scene.updateMatrixWorld(true);
    const compiled = new Set<string>();
    await prewarmPipelines(recordingRenderer(compiled), [scene], new PerspectiveCamera(), () => () => {});
    expect([...compiled].sort()).toEqual(["left", "pool0", "pool1", "pool2", "right"]);
    expect(twin.layers.mask).toBe(1);
  });
});
