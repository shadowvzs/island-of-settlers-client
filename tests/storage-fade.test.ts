import { BoxGeometry,Group, Mesh, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import { createStorageFadeFrames, STORAGE_FADE_SECONDS } from "../src/app/settlement/storage-fade-frames";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import { createWorkerFade } from "../src/renderers/three/worker-fade";

const world = { cellsX: 8, cellsZ: 8, heights: new Float32Array(81) };
const carrier = (x: number, z: number) => ({ actorId: 7, selected: true, visible: true, x, y: 0, z }) as WorkerFrame;

describe("bridge wait fade presentation", () => {
  it("fades the carrier out where it waited and in at the storage, then stops", () => {
    const apply = createStorageFadeFrames(world);
    const first = [carrier(5, 5)];
    apply(first, [{ actor: 7, from: { x: 1, z: 2 }, to: { x: 5, z: 5 } }], STORAGE_FADE_SECONDS / 4);
    expect(first).toHaveLength(2);
    expect(first[0]!.fade).toBeCloseTo(0.25);
    expect(first[1]).toMatchObject({ fade: 0.75, selected: false, x: 1, z: 2 });
    expect(first[1]!.actorId).not.toBe(7);
    const later = [carrier(5.2, 5)];
    apply(later, [], STORAGE_FADE_SECONDS);
    expect(later).toHaveLength(1);
    expect(later[0]!.fade).toBeUndefined();
  });

  it("borrows transparent copies only while fading and restores the shared materials", () => {
    const shared = new MeshStandardMaterial();
    const root = new Group();
    const mesh = new Mesh(new BoxGeometry(), shared);
    root.add(mesh);
    const fade = createWorkerFade(root);
    fade.set(0.4);
    const copy = mesh.material as MeshStandardMaterial;
    expect(copy).not.toBe(shared);
    expect(copy.transparent && copy.opacity).toBeCloseTo(0.4);
    expect(shared.transparent).toBe(false);
    fade.set(1);
    expect(mesh.material).toBe(shared);
  });
});
