import type { CharacterLodLevel } from "@workers/character-lods/lod-policy";
import {
  Bone, BoxGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Skeleton, SkinnedMesh
} from "three";
import { describe, expect, it, vi } from "vitest";

import { QUALITY_PRESETS } from "../src/render-common/quality";
import type { OwnedAssetLease } from "../src/renderers/three/owned-asset-cache";
import { SHADOW_CASTER_LAYER } from "../src/renderers/three/three-shadows";
import { createWorkerDetail } from "../src/renderers/three/worker-detail";
import type { WorkerLodTemplate } from "../src/renderers/three/worker-lod-sources";

const high = QUALITY_PRESETS.high.characters;

/** A rig of `names` joints with one skinned body and one tunic mesh, like a loaded worker clone. */
const rig = (names: readonly string[], tint = 0x336699) => {
  const root = new Group();
  const bones = names.map(name => Object.assign(new Bone(), { name }));
  bones.forEach((bone, index) => { if (index) bones[index - 1]!.add(bone); });
  root.add(bones[0]!);
  const skeleton = new Skeleton(bones);
  const body = new SkinnedMesh(new BoxGeometry(), new MeshStandardMaterial({ name: "skin" }));
  body.name = "body"; body.bind(skeleton, new Matrix4());
  const tunic = new SkinnedMesh(new BoxGeometry(), new MeshStandardMaterial({ color: tint, name: "tunic_team_linen" }));
  tunic.name = "tunic"; tunic.bind(skeleton, new Matrix4());
  root.add(body, tunic);
  return { body, root, skeleton, tunic };
};

const JOINTS = ["Hips", "Spine", "Head"];

/** A level file template whose meshes carry the same joints and a deferred lease. */
const templateLease = (level: CharacterLodLevel, joints = JOINTS) => {
  const template = rig(joints, 0xffffff);
  let resolve!: (value: WorkerLodTemplate) => void;
  const release = vi.fn();
  const lease: OwnedAssetLease<WorkerLodTemplate> = {
    promise: new Promise(done => { resolve = done; }), release
  };
  const value: WorkerLodTemplate = {
    meshes: [template.body, template.tunic],
    record: { draws: 2, level, maps: "vertexColor", model: "", rig: "crowd", source: "", triangles: 700 },
    release: vi.fn()
  };
  return { lease, release, resolve: () => resolve(value), template };
};

const actor = (levels: Partial<Record<CharacterLodLevel, ReturnType<typeof templateLease>>>, base: CharacterLodLevel = 0) => {
  const body = rig(JOINTS);
  const acquire = vi.fn((level: CharacterLodLevel) => levels[level]!.lease);
  const lods = { acquire, base, has: (level: CharacterLodLevel) => level in levels };
  return { ...body, acquire, detail: createWorkerDetail({ lods, root: body.root }, high) };
};

describe("worker runtime level of detail", () => {
  it("does nothing for a body without authored levels", () => {
    const body = rig(JOINTS);
    const detail = createWorkerDetail({ root: body.root }, high);
    detail.update(5, 0);
    expect(detail.level()).toBe(0);
    expect(body.body.visible).toBe(true);
    detail.dispose();
  });

  it("requests a coarser level lazily, then swaps the drawn meshes onto the actor's skeleton", async () => {
    const lod2 = templateLease(2);
    const { acquire, body, detail, root, skeleton, tunic } = actor({ 2: lod2 });
    detail.update(60, 1);
    expect(acquire).toHaveBeenCalledWith(2);
    expect(detail.level()).toBe(0);
    expect(body.visible).toBe(true);
    lod2.resolve();
    await lod2.lease.promise;
    expect(detail.level()).toBe(2);
    expect(body.visible).toBe(false);
    expect(tunic.visible).toBe(false);
    const shown = root.children.filter((child): child is SkinnedMesh => child instanceof SkinnedMesh && child.visible);
    expect(shown.map(mesh => mesh.name)).toEqual(["body", "tunic"]);
    expect(shown.every(mesh => mesh.skeleton === skeleton)).toBe(true);
    expect(shown[0]!.geometry).toBe(lod2.template.body.geometry);
    // The tint is this actor's own clone, already in the actor's colour; the skin material is shared.
    const tint = shown[1]!.material as MeshStandardMaterial;
    expect(tint).not.toBe(lod2.template.tunic.material);
    expect(tint.color.getHex()).toBe(0x336699);
    expect(shown[0]!.material).toBe(lod2.template.body.material);
    detail.dispose();
    expect(lod2.release).toHaveBeenCalledTimes(1);
    expect(root.children.filter(child => child instanceof Mesh)).toEqual([body, tunic]);
  });

  it("returns to the base body and respects the hold and hysteresis", async () => {
    const lod1 = templateLease(1), lod2 = templateLease(2);
    const { body, detail } = actor({ 1: lod1, 2: lod2 });
    detail.update(60, 1);
    lod2.resolve(); await lod2.lease.promise;
    expect(detail.level()).toBe(2);
    // Inside the hold nothing changes, even far above the edge.
    detail.update(2000, 1.1);
    expect(detail.level()).toBe(2);
    // Just above the LOD1 edge is inside the hysteresis band: still LOD2.
    detail.update(125, 2);
    expect(detail.level()).toBe(2);
    // Clearly above: LOD1 is requested and shown once it arrives.
    detail.update(200, 2.5);
    expect(detail.level()).toBe(2);
    lod1.resolve(); await lod1.lease.promise;
    expect(detail.level()).toBe(1);
    // Far above the hero edge the base body returns at once (no load).
    detail.update(2000, 3);
    expect(detail.level()).toBe(0);
    expect(body.visible).toBe(true);
    detail.dispose();
    expect(lod1.release).toHaveBeenCalled();
    expect(lod2.release).toHaveBeenCalled();
  });

  it("never shows a level finer than the loaded base body (Minimal soldiers start at LOD2)", () => {
    const lod1 = templateLease(1), lod3 = templateLease(3);
    const { acquire, detail } = actor({ 1: lod1, 3: lod3 }, 2);
    // A possessed close-up would ask Minimal civilians for LOD1; the LOD2 soldier base stays.
    detail.update(300, 1);
    expect(acquire).not.toHaveBeenCalled();
    expect(detail.level()).toBe(2);
    detail.dispose();
  });

  it("falls back to the nearest authored level and skips a rig that does not match", async () => {
    const lod3 = templateLease(3), odd = templateLease(2, ["Hips", "Spine"]);
    const { acquire, detail } = actor({ 2: odd, 3: lod3 });
    detail.update(60, 1);
    odd.resolve(); await odd.lease.promise;
    expect(detail.level()).toBe(0);
    expect(odd.release).toHaveBeenCalled();
    // The failed level is skipped from now on: the next coarser file serves the band.
    detail.update(60, 2);
    expect(acquire).toHaveBeenLastCalledWith(3);
    lod3.resolve(); await lod3.lease.promise;
    expect(detail.level()).toBe(3);
    detail.dispose();
  });

  it("releases a level that arrives after disposal", async () => {
    const lod2 = templateLease(2);
    const { detail, root } = actor({ 2: lod2 });
    detail.update(60, 1);
    detail.dispose();
    lod2.resolve(); await lod2.lease.promise;
    expect(lod2.release).toHaveBeenCalled();
    expect(root.children.filter(child => child instanceof SkinnedMesh)).toHaveLength(2);
  });

  it("applies a camera jump's finer level at once after refresh, without the hold (C11)", async () => {
    const lod2 = templateLease(2);
    const { detail } = actor({ 2: lod2 });
    detail.update(60, 1);
    lod2.resolve();
    await lod2.lease.promise;
    expect(detail.level()).toBe(2);
    // 0.1 s after the level change the hold still blocks the promotion back to LOD0.
    detail.update(600, 1.1);
    expect(detail.level()).toBe(2);
    detail.refresh();
    detail.update(600, 1.1);
    expect(detail.level()).toBe(0);
    detail.dispose();
  });

  it("casts the sun shadow with a caster-only LOD2 proxy while a finer level is shown", async () => {
    const lod2 = templateLease(2);
    const { acquire, body, detail, root } = actor({ 2: lod2 });
    detail.setCaster(true);
    // Until the proxy arrives, the shown base body casts and stays drawn.
    expect(acquire).toHaveBeenCalledWith(2);
    expect(body.layers.isEnabled(0)).toBe(true);
    expect(body.layers.isEnabled(SHADOW_CASTER_LAYER)).toBe(true);
    lod2.resolve(); await lod2.lease.promise;
    expect(detail.level()).toBe(0);
    const proxy = root.children.filter((child): child is SkinnedMesh =>
      child instanceof SkinnedMesh && child.geometry === lod2.template.body.geometry);
    expect(proxy).toHaveLength(1);
    expect(proxy[0]!.visible).toBe(true);
    expect(proxy[0]!.layers.isEnabled(0)).toBe(false);
    expect(proxy[0]!.layers.isEnabled(SHADOW_CASTER_LAYER)).toBe(true);
    expect(body.layers.isEnabled(0)).toBe(true);
    expect(body.layers.isEnabled(SHADOW_CASTER_LAYER)).toBe(false);
    // At LOD2 the shown meshes cast themselves; switched off, nothing casts and the proxy hides.
    detail.update(60, 1);
    expect(detail.level()).toBe(2);
    expect(proxy[0]!.layers.mask).toBe(1 | 1 << SHADOW_CASTER_LAYER);
    detail.update(2000, 2);
    detail.setCaster(false);
    expect(detail.level()).toBe(0);
    expect(proxy[0]!.visible).toBe(false);
    expect(body.layers.mask).toBe(1);
    expect(acquire).toHaveBeenCalledTimes(1);
    detail.dispose();
  });
});
