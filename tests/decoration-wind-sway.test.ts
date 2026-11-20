import { BufferGeometry, DataTexture, Float32BufferAttribute, Group, type InstancedMesh, Mesh, MeshDepthMaterial,
  MeshStandardMaterial, Vector2, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from "three";
import { describe, expect, it, vi } from "vitest";

import { decorationSwayPart, decorationSwayWeights } from "../src/render-common/plants/decoration-sway-weights";
import { QUALITY_PRESETS } from "../src/render-common/quality";
import { createDecorationWindSway } from "../src/renderers/three/plants/decoration-wind-sway";
import { createThreeRoadDecorations } from "../src/renderers/three/settlement/three-road-decorations";
import type { RoadDecorationFrame } from "../src/shared/settlement/road-decoration-state";
import { createPlainBuildingMaterials } from "./helpers/building-materials";
import { huntingWorld } from "./helpers/hunting-world";

const swayUniforms = () => ({ uNoiseTexture: { value: new DataTexture() }, uTime: { value: 0 },
  uWind: { value: new Vector2(.8, .35) }, uWindPhase: { value: new Vector2() } });

const geometry = (points: number[][]) => {
  const created = new BufferGeometry();
  created.setAttribute("position", new Float32BufferAttribute(points.flat(), 3));
  return created;
};

const template = (names: readonly string[]) => {
  const root = new Group(), dispose = vi.fn();
  for (const name of names) {
    const mesh = new Mesh(geometry([[0, 0, 0], [0, .3, 0], [.4, 1.2, 0]]), new MeshStandardMaterial());
    mesh.name = name; root.add(mesh);
  }
  return { dispose, key: "test", root, triangles: 1 };
};

describe("D08 decoration wind sway", () => {
  it("is a High-only preset flag", () => {
    expect(QUALITY_PRESETS.high.decorationWind).toBe(true);
    for (const level of ["medium", "low", "minimal"] as const) expect(QUALITY_PRESETS[level].decorationWind).toBe(false);
  });

  it("classifies structures before plant parts and rejects unknown parts", () => {
    expect(decorationSwayPart("hollow-glazed-ceramic-rim-and-bearing-feet")).toBe("structure");
    expect(decorationSwayPart("supported-root-bearing-soil")).toBe("structure");
    expect(decorationSwayPart("pot")).toBe("structure");
    expect(decorationSwayPart("flowering-bark")).toBe("wood");
    expect(decorationSwayPart("continuous-trunk-root-branch-petiole")).toBe("wood");
    expect(decorationSwayPart("flowering-foliage")).toBe("foliage");
    expect(decorationSwayPart("flowering-blossoms")).toBe("foliage");
    expect(decorationSwayPart("paint")).toBeUndefined();
  });

  it("roots the plant at its pot, grows trunk < branch < leaf and pins leaves where they touch wood", () => {
    const [pot, wood, foliage] = decorationSwayWeights([
      { part: "structure", positions: [0, 0, 0, .2, .3, 0] },
      { part: "wood", positions: [0, .25, 0, 0, 1.5, 0, .5, 1.5, 0] },
      { part: "foliage", positions: [0, 1.5, 0, .9, 1.5, 0, .5, 1.5, 0] }
    ]);
    expect(pot).toBeUndefined();
    expect(wood![0]).toBe(0);
    expect(wood![3]).toBeGreaterThan(0);
    expect(wood![4]).toBe(0);
    expect(wood![7]).toBeGreaterThan(0);
    // A leaf vertex on the wood moves exactly like the wood there: same bend, same branch, no flutter.
    expect(Array.from(foliage!.slice(0, 3))).toEqual([wood![3], wood![4], 0]);
    expect(Array.from(foliage!.slice(6, 9))).toEqual([wood![6], wood![7], 0]);
    expect(foliage![5]).toBe(255);
  });

  it("gives plant meshes swaying twins with a matching depth twin and leaves structures static", () => {
    const sway = createDecorationWindSway(swayUniforms()), source = template(["pot", "bark", "foliage"]);
    const [pot, bark, leaves] = source.root.children as Mesh<BufferGeometry, MeshStandardMaterial>[];
    const potMaterial = pot!.material, barkMaterial = bark!.material;
    const prepared = sway.prepare(source);
    expect(pot!.material).toBe(potMaterial);
    expect(pot!.geometry.getAttribute("decorationSway")).toBeUndefined();
    expect(bark!.material).not.toBe(barkMaterial);
    expect(bark!.customDepthMaterial).toBeInstanceOf(MeshDepthMaterial);
    expect(leaves!.geometry.getAttribute("decorationSway").itemSize).toBe(3);
    expect(bark!.material.customProgramCacheKey()).not.toBe(barkMaterial.customProgramCacheKey());
    const shader = { fragmentShader: "", uniforms: {}, vertexShader: "#include <begin_vertex>" } as
      unknown as WebGLProgramParametersWithUniforms;
    bark!.material.onBeforeCompile(shader, {} as WebGLRenderer);
    expect(shader.vertexShader).toContain("attribute vec3 decorationSway;");
    expect(Object.keys(shader.uniforms).sort()).toEqual(["uNoiseTexture", "uTime", "uWind", "uWindPhase"]);
    const freed = vi.fn(); bark!.material.addEventListener("dispose", freed);
    prepared.dispose();
    expect(source.dispose).toHaveBeenCalledOnce(); expect(freed).toHaveBeenCalledOnce();
    expect(sway.prepare(prepared)).toBe(prepared);
  });

  it("keeps templates with unknown parts, and every template without shared wind, static", () => {
    const unknown = template(["bark", "paint"]);
    expect(createDecorationWindSway(swayUniforms()).prepare(unknown)).toBe(unknown);
    const islandFree = template(["bark", "foliage"]);
    expect(createDecorationWindSway({}).prepare(islandFree)).toBe(islandFree);
  });

  it("sways near catalog plants only when the layer enables it", async () => {
    const item = "roadDecoration:plant-boxwood-roadside-pot-0:native";
    const frame: RoadDecorationFrame = { uid: 1, item, position: [5, 2, 5], supports: [], volumes: [], yaw: 0 };
    for (const enabled of [true, false]) {
      const world = huntingWorld(); world.fogDisplayDisabled = true;
      const materials = createPlainBuildingMaterials();
      const owner = createThreeRoadDecorations(world, true, () => materials, undefined, swayUniforms(), true,
        undefined, enabled);
      try {
        owner.update([frame]); await owner.ready(); owner.update([frame]);
        const meshes = owner.root.children.filter(child => child.name.startsWith("plant:")) as InstancedMesh[];
        const swaying = meshes.filter(mesh => mesh.geometry.getAttribute("decorationSway"));
        expect(meshes.length).toBeGreaterThan(0);
        expect(swaying.map(mesh => mesh.name.split("/").at(-1)).sort())
          .toEqual(enabled ? ["green", "stems"] : []);
      } finally { owner.dispose(); Object.values(materials).forEach(material => material.dispose()); }
    }
  });
});
