import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Mesh, PerspectiveCamera, Texture, Vector3 } from "three";
import { expect, it, vi } from "vitest";

import { roadDecorationClearance } from "../src/render-common/road-decoration-clearance";
import { createWisteriaHeroGraph } from "../src/render-common/wisteria-hero-graph";
import { WISTERIA_PRODUCTION_ATLAS } from "../src/render-common/wisteria-production-atlas-data";
import { createOrnamentalPlantLod } from "../src/renderers/three/plants/ornamental-plant-lod";
import { createWisteriaProductionModels } from "../src/renderers/three/wisteria-production-model";
import { getRoadDecoration } from "../src/shared/settlement/road-decoration-catalog";
import { planRoadDecorationPlacement } from "../src/shared/settlement/road-decoration-placement";
import { createRoadDecorationState } from "../src/shared/settlement/road-decoration-state";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

const originals = {
  curved: "0f8a08e15d59882d0d62bc46bf19f085997b9c8fe568612bfae997ed19adb19f",
  lattice: "26634ff96c711ea9ad54dbbb8d702e07d26f954dadf0b96c0813601a9af81f48",
  pergola: "e6ce1746aaf245a2f8e243e5fbc3d0709533d6cb7ec6b1b44c012e0ab8748372"
};

it("retains every original K botanical pose and the exact canonical bake metadata", () => {
  for (const frame of ["curved", "lattice", "pergola"] as const) {
    const { composition, flowers, leaves } = createWisteriaHeroGraph(frame);
    const hash = createHash("sha256").update(JSON.stringify({ flowers, leaves, composition, frame })).digest("hex");
    expect(hash).toBe(originals[frame]);
  }
  expect(WISTERIA_PRODUCTION_ATLAS).toEqual(JSON.parse(readFileSync(new URL(
    "../assets/botanical-textures/wisteria-owned-lod-atlas-candidate.json", import.meta.url
  ), "utf8")));
});

it.each([[true, "near"], [true, "far"], [false, "near"], [false, "far"]] as const)("uses flat shared runtime surfaces within budget and actual canonical bounds (High=%s, tier=%s)", async (detailed, tier) => {
  const materials = createPlainBuildingMaterials();
  const factory = createWisteriaProductionModels(materials, detailed, async () => new Texture(), async () => new Texture());
  try {
    for (const frame of ["curved", "lattice", "pergola"] as const) {
      const model = await factory.create(frame, undefined, tier), definition = getRoadDecoration(`wisteria-${frame}`)!;
      const bounds = roadDecorationClearance(definition).volumes;
      try {
        expect(model.triangles).toBeLessThanOrEqual(definition.triangles[detailed ? 0 : 1]);
        expect(model.root.children.length).toBeGreaterThan(3);
        expect(model.root.children.every(child => child instanceof Mesh && !("isInstancedMesh" in child))).toBe(true);
        const point = new Vector3();
        for (const part of model.root.children) {
          const geometry = (part as Mesh).geometry, positions = geometry.getAttribute("position");
          for (let vertex = 0; vertex < positions.count; vertex++) {
            point.fromBufferAttribute(positions, vertex);
            expect(bounds.some(box => point.x >= box.min[0] - .000001 && point.x <= box.max[0] + .000001 &&
              point.y >= box.min[1] - .000001 && point.y <= box.max[1] + .000001 &&
              point.z >= box.min[2] - .000001 && point.z <= box.max[2] + .000001),
            `${frame}: ${part.name} vertex ${vertex} at ${point.toArray().join(",")}`).toBe(true);
          }
        }
      } finally { model.dispose(); }
    }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
});

it("shares neutral atlas and frame geometry across colours until the final idempotent release", async () => {
  const materials = createPlainBuildingMaterials(), atlas = new Texture(), released = vi.fn(), load = vi.fn(async () => atlas);
  atlas.addEventListener("dispose", released);
  const factory = createWisteriaProductionModels(materials, true, load);
  const [purple, white] = await Promise.all([factory.create("curved"), factory.create("curved", "white")]);
  expect(load).toHaveBeenCalledTimes(1);
  expect((purple.root.children[0] as Mesh).geometry).toBe((white.root.children[0] as Mesh).geometry);
  expect(purple.flowerColour).not.toEqual(white.flowerColour);
  purple.dispose(); purple.dispose(); expect(released).not.toHaveBeenCalled();
  white.dispose(); white.dispose(); expect(released).toHaveBeenCalledTimes(1);
  Object.values(materials).forEach(material => material.dispose());
});

it("retries a failed atlas request without retaining a broken shared owner", async () => {
  const materials = createPlainBuildingMaterials(), atlas = new Texture();
  const load = vi.fn<() => Promise<Texture>>().mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(atlas);
  const factory = createWisteriaProductionModels(materials, false, load);
  await expect(factory.create("curved")).rejects.toThrow("offline");
  const restored = await factory.create("curved");
  expect(restored.triangles).toBeGreaterThan(1000); expect(load).toHaveBeenCalledTimes(2);
  restored.dispose(); Object.values(materials).forEach(material => material.dispose());
});

it("keeps arch supports outside the true passage and rejects unsupported slopes before mutation", () => {
  const definition = getRoadDecoration("wisteria-curved")!, contract = roadDecorationClearance(definition);
  expect(contract.supports).toHaveLength(2);
  expect(contract.supports.every(box => box.max[0] < -definition.opening!.width / 2 ||
    box.min[0] > definition.opening!.width / 2)).toBe(true);
  const place = (grade: number) => planRoadDecorationPlacement({ decoration: definition.id,
    position: { x: 10, z: 10 }, yaw: 0 }, { nation: "roman", roads: [],
    heightAt: x => x * grade, isOwned: () => true, isFree: () => true });
  expect(place(0).ok).toBe(true); expect(place(.005).ok).toBe(true);
  expect(place(.1)).toEqual({ ok: false, reason: "uneven-support-ground" });
});

it("protects actual straight two-cart road traffic and refuses a post placed into that corridor", () => {
  const roads = [{ start: { x: 10, z: 7 }, end: { x: 10, z: 13 }, tier: "stone" as const }];
  const context = { nation: "roman" as const, roads, heightAt: () => 0,
    isOwned: () => true, isFree: () => true };
  for (const decoration of ["wisteria-curved", "wisteria-lattice", "wisteria-pergola",
    "japanese-hanging-lantern-torii", "chinese-hanging-lantern-pailou"]) {
    expect(planRoadDecorationPlacement({ decoration, position: { x: 10, z: 10 }, yaw: 0 }, context).ok,
      decoration).toBe(true);
    expect(planRoadDecorationPlacement({ decoration, position: { x: 10.7, z: 10 }, yaw: 0 }, context))
      .toEqual({ ok: false, reason: "road-traffic-obstructed" });
  }
});


it("keeps near3D and far atlas leases independent while sharing each across palettes", async () => {
  const materials = createPlainBuildingMaterials(), farAtlas = new Texture(), nearAtlas = new Texture();
  const farDisposed = vi.fn(), nearDisposed = vi.fn();
  farAtlas.addEventListener("dispose", farDisposed); nearAtlas.addEventListener("dispose", nearDisposed);
  const factory = createWisteriaProductionModels(materials, true, async () => farAtlas, async () => nearAtlas);
  const [near, white, far] = await Promise.all([factory.create("curved", undefined, "near"),
    factory.create("curved", "white", "near"), factory.create("curved", undefined, "far")]);
  expect(near.triangles).toBeGreaterThan(20000); expect(near.triangles).toBeLessThanOrEqual(24000);
  expect(far.triangles).toBeLessThan(4000);
  expect((near.root.children[0] as Mesh).geometry).toBe((white.root.children[0] as Mesh).geometry);
  expect((near.root.children[0] as Mesh).geometry).not.toBe((far.root.children[0] as Mesh).geometry);
  expect(near.root.children.filter(child => child.name === "paint")).toHaveLength(1);
  near.dispose(); expect(nearDisposed).not.toHaveBeenCalled();
  far.dispose(); expect(farDisposed).toHaveBeenCalledTimes(1); expect(nearDisposed).not.toHaveBeenCalled();
  white.dispose(); white.dispose(); expect(nearDisposed).toHaveBeenCalledTimes(1);
  Object.values(materials).forEach(material => material.dispose());
});


it("selects actual rotated canonical frames at the native near/far/overview capture distances", () => {
  for (const detailed of [true, false]) for (const frame of ["curved", "lattice", "pergola"] as const) {
    const state = createRoadDecorationState(() => ({ nation: "roman", roads: [], heightAt: () => 0,
      isOwned: () => true, isFree: () => true }));
    expect(state.place({ item: `roadDecoration:wisteria-${frame}:native`, position: { x: 10, z: 10 },
      yaw: Math.PI / 4 }, () => true).ok).toBe(true);
    const camera = new PerspectiveCamera(35, 1100 / 900, .02, 1000), lod = createOrnamentalPlantLod(detailed);
    for (const [distance, tier] of [[6, "near"], [85, "far"], [400, "overview"], [6, "near"]] as const) {
      camera.position.set(10, 2.2 + distance * .12, 10 + distance); camera.lookAt(10, 1.65, 10);
      lod.update(state.frames(), camera, 900);
      expect(lod.tierFor(state.frames()[0]!.uid), `${frame} High=${detailed} ${distance}m`).toBe(tier);
    }
    lod.dispose();
  }
});
