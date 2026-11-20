import {
  DataTexture,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardMaterial,
  MeshStandardNodeMaterial,
  RGBAFormat
} from "three/webgpu";
import { describe, expect, it } from "vitest";

import { needsStandInMapSync } from "../src/renderers/three/webgpu/stand-in-map";
import { applyBuildingMaterialExtensions } from "../src/renderers/webgpu/tsl/buildings";

const standardStandIn = () => new MeshStandardNodeMaterial();
const sourceMaterial = (shaderKey?: string) => {
  const material = new MeshStandardMaterial();
  if (shaderKey !== undefined) material.userData.shaderKey = shaderKey;
  return material;
};

describe("TSL-9 building material extensions", () => {
  it("leaves a plain lit surface alone", () => {
    const material = standardStandIn();
    applyBuildingMaterialExtensions(material, sourceMaterial(), new Mesh());
    expect(material.positionNode).toBeNull();
    expect(material.normalNode).toBeNull();
    expect(material.opacityNode).toBeNull();
    expect(material.userData.syncUniforms).toBeUndefined();
  });

  it("clips a Roman construction wall at its course height", () => {
    const material = standardStandIn();
    const mesh = new Mesh();
    const height = { value: 1.2 };
    mesh.userData.constructionCourses = { bounds: null, height };
    applyBuildingMaterialExtensions(material, sourceMaterial(), mesh);
    expect(material.opacityNode).not.toBeNull();
    const sync = material.userData.syncUniforms as () => void;
    expect(typeof sync).toBe("function");
    height.value = Infinity;
    expect(() => sync()).not.toThrow();
  });

  it("clips a monument under construction at its world height", () => {
    const material = standardStandIn();
    const source = sourceMaterial("monument-construction-v1");
    source.userData.constructionHeight = { value: 2.5 };
    applyBuildingMaterialExtensions(material, source, new Mesh());
    expect(material.opacityNode).not.toBeNull();
    expect(typeof material.userData.syncUniforms).toBe("function");
  });

  it("keeps the hanging decor swinging about its pivot", () => {
    const material = standardStandIn();
    applyBuildingMaterialExtensions(material, sourceMaterial("hanging-decor-sway-v1"), new Mesh());
    expect(material.positionNode).not.toBeNull();
    expect(material.normalNode).not.toBeNull();
    expect(typeof material.userData.syncUniforms).toBe("function");
  });

  it("keeps the Nubian cloth wind on the vertex position", () => {
    const material = standardStandIn();
    applyBuildingMaterialExtensions(material, sourceMaterial("nubian-cloth-wind-v1"), new Mesh());
    expect(material.positionNode).not.toBeNull();
  });

  it("does not bind vertex extensions to a basic stand-in", () => {
    const material = new MeshBasicNodeMaterial();
    applyBuildingMaterialExtensions(material, sourceMaterial("hanging-decor-sway-v1"), new Mesh());
    expect(material.positionNode).toBeNull();
  });

  it("uses the mesh construction courses before any material key", () => {
    const material = standardStandIn();
    const mesh = new Mesh();
    mesh.userData.constructionCourses = { height: { value: 3 } };
    applyBuildingMaterialExtensions(material, sourceMaterial("nubian-cloth-wind-v1"), mesh);
    expect(material.opacityNode).not.toBeNull();
    expect(material.positionNode).toBeNull();
  });

  it("applies a construction clip only when its height source is present", () => {
    const material = standardStandIn();
    applyBuildingMaterialExtensions(material, sourceMaterial("monument-construction-v1"), new Group());
    expect(material.opacityNode).toBeNull();
  });
});

describe("TSL-9 late-loaded stand-in maps", () => {
  const texture = () => new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat);

  it("ignores a material without a map (null or unset), so its tint survives", () => {
    const standIn = standardStandIn();
    expect(needsStandInMapSync(standIn, sourceMaterial())).toBe(false);
    const undefinedMap = new MeshStandardMaterial();
    (undefinedMap as unknown as { map: unknown }).map = undefined;
    expect(needsStandInMapSync(standIn, undefinedMap)).toBe(false);
  });

  it("syncs a map that appears after the stand-in was built", () => {
    const standIn = standardStandIn();
    const source = sourceMaterial();
    source.map = texture();
    expect(needsStandInMapSync(standIn, source)).toBe(true);
  });

  it("keeps a stand-in already built with its source map", () => {
    const standIn = standardStandIn();
    const map = texture();
    const source = sourceMaterial();
    source.map = map;
    standIn.userData.wg4MapSource = map;
    expect(needsStandInMapSync(standIn, source)).toBe(false);
  });
});
