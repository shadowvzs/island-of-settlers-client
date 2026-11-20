import { TEAM_TINT_MATERIAL } from "@workers/character-lods/lod-policy";
import {
  Bone, BoxGeometry, BufferAttribute, DoubleSide, FrontSide, Group, MeshStandardMaterial, ShaderLib, Skeleton,
  SkinnedMesh, type WebGLProgramParametersWithUniforms
} from "three";
import { describe, expect, it } from "vitest";

import { CrowdBodyMaterial, mergeCrowdLevelMeshes, setCrowdBodyTint } from "../src/renderers/three/worker-crowd-body";

/** A C04 crowd level: one skin, vertex colours (normalised uint16 RGBA), no maps. */
const part = (skeleton: Skeleton, material: MeshStandardMaterial, shade: number) => {
  const geometry = new BoxGeometry(.2, .4, .2).toNonIndexed();
  const count = geometry.getAttribute("position").count;
  geometry.deleteAttribute("uv");
  geometry.setAttribute("color", new BufferAttribute(new Uint16Array(count * 4).fill(shade), 4, true));
  geometry.setAttribute("skinIndex", new BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute("skinWeight", new BufferAttribute(new Float32Array(count * 4).fill(.25), 4));
  const mesh = new SkinnedMesh(geometry, material);
  mesh.name = "body";
  mesh.bind(skeleton);
  return mesh;
};
const level = () => {
  const root = new Group(), bone = new Bone();
  root.add(bone);
  const skeleton = new Skeleton([bone]);
  const body = new MeshStandardMaterial({ color: 0xcccccc, metalness: .15, roughness: .72, vertexColors: true });
  body.name = "worker_body";
  const tunic = new MeshStandardMaterial({ roughness: .9, side: DoubleSide, vertexColors: true });
  tunic.name = TEAM_TINT_MATERIAL;
  const meshes = [part(skeleton, body, 30000), part(skeleton, tunic, 60000)];
  root.add(...meshes);
  return { body, meshes, skeleton, tunic };
};
const surfaceOf = (mesh: SkinnedMesh, vertex: number) => {
  const surface = mesh.geometry.getAttribute("crowdSurface");
  return [surface.getX(vertex), surface.getY(vertex), surface.getZ(vertex), surface.getW(vertex)];
};

describe("one draw per LOD2/LOD3 crowd body", () => {
  it("merges the parts onto the same skeleton and bind matrix with per-vertex surfaces", () => {
    const { body, meshes, skeleton } = level();
    const merged = mergeCrowdLevelMeshes(meshes)!;
    const count = meshes[0]!.geometry.getAttribute("position").count;

    expect(merged.skeleton).toBe(skeleton);
    expect(merged.bindMatrix.equals(meshes[0]!.bindMatrix)).toBe(true);
    expect(merged.geometry.getAttribute("position").count).toBe(count * 2);
    expect(merged.material).toBeInstanceOf(CrowdBodyMaterial);
    const material = merged.material as CrowdBodyMaterial;
    expect(material).toMatchObject({ frontFacesOnly: true, side: DoubleSide, vertexColors: true });
    // Flags: front faces only (2) for the single-sided body, team tint (1) for the double-sided tunic.
    expect(surfaceOf(merged, 0).map(value => Math.fround(value)))
      .toEqual([Math.fround(.72), Math.fround(.15), 2, 0]);
    expect(surfaceOf(merged, count).map(value => Math.fround(value))).toEqual([Math.fround(.9), 0, 1, 0]);
    // The body's colour factor is baked; the tint cloth keeps its vertex colour for the tint uniform.
    const colors = merged.geometry.getAttribute("color");
    expect(colors.getX(0)).toBeCloseTo(30000 / 65535 * body.color.r, 6);
    expect(colors.getX(count)).toBeCloseTo(60000 / 65535, 6);
  });

  it("keeps one front-faced material without the cull flag when every part is single-sided", () => {
    const { meshes, tunic } = level();
    tunic.side = FrontSide;
    const material = mergeCrowdLevelMeshes(meshes)!.material as CrowdBodyMaterial;
    expect(material).toMatchObject({ frontFacesOnly: false, side: FrontSide });
  });

  it("carries an alpha cut-off part per vertex", () => {
    const { meshes, tunic } = level();
    tunic.alphaTest = .5;
    const merged = mergeCrowdLevelMeshes(meshes)!;
    expect((merged.material as CrowdBodyMaterial)).toMatchObject({ alphaCutoff: true, alphaTest: 0 });
    expect(surfaceOf(merged, 0)[3]).toBe(0);
    expect(surfaceOf(merged, meshes[0]!.geometry.getAttribute("position").count)[3]).toBe(.5);
  });

  it.each([
    ["a map", (material: MeshStandardMaterial) => { material.normalMap = {} as never; }],
    ["an emissive glow", (material: MeshStandardMaterial) => { material.emissive.set(0xff0000); }],
    ["a transparent part", (material: MeshStandardMaterial) => { material.transparent = true; }]
  ])("leaves the parts alone when one has %s", (_name, change) => {
    const { meshes, tunic } = level();
    change(tunic);
    expect(mergeCrowdLevelMeshes(meshes)).toBeNull();
  });

  it("keeps the tint per actor clone and the hover brightening on the colour", () => {
    const { meshes } = level();
    const material = mergeCrowdLevelMeshes(meshes)!.material as CrowdBodyMaterial;
    const clone = material.clone();
    expect(setCrowdBodyTint(clone, 0x426eaf)).toBe(true);
    expect(clone.tint.getHex()).toBe(0x426eaf);
    expect(material.tint.getHex()).toBe(0xffffff);
    expect(clone.clone()).toMatchObject({ frontFacesOnly: true, tint: clone.tint });
    expect(clone.color.getHex()).toBe(0xffffff);
    expect(setCrowdBodyTint(new MeshStandardMaterial(), 0x426eaf)).toBe(false);
  });

  it("patches every chunk it relies on in the standard shader", () => {
    const material = new CrowdBodyMaterial();
    material.frontFacesOnly = true;
    material.alphaCutoff = true;
    const shader = { fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {},
      vertexShader: ShaderLib.standard.vertexShader } as unknown as WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader);
    expect(shader.uniforms.crowdTint!.value).toBe(material.tint);
    expect(shader.vertexShader).toContain("vCrowdSurface = crowdSurface;");
    for (const line of ["float roughnessFactor = vCrowdSurface.x;", "float metalnessFactor = vCrowdSurface.y;",
      "mix( vec3( 1.0 ), crowdTint, mod( vCrowdSurface.z, 2.0 ) )",
      "if ( vCrowdSurface.z >= 2.0 && ! gl_FrontFacing ) discard;",
      // The cut-off tests the part's own alpha: a figure fading (opacity < 1) keeps its masked parts.
      "if ( diffuseColor.a < vCrowdSurface.w * opacity ) discard;"])
      expect(shader.fragmentShader).toContain(line);
    expect(shader.fragmentShader).not.toContain("#include <roughnessmap_fragment>");
    expect(material.customProgramCacheKey()).not.toBe(new CrowdBodyMaterial().customProgramCacheKey());
  });
});
