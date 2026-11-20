import { BoxGeometry, DataTexture, Group, Mesh, MeshStandardMaterial, Texture } from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { expect, it } from "vitest";

import { exportNormalMapPixels, invalidBuildingExportTextures, prepareBuildingExportNormalMaps, withBuildingExportNormalMaps } from "../tools/bench/building-export-normal-maps";

it("copies raw pixels without changing their source and rejects unsupported encodings", () => {
  const pixels = new Uint8Array([12, 34, 56, 255]);
  const texture = new DataTexture(pixels, 1, 1), source = texture.source;
  const copy = exportNormalMapPixels(texture);
  expect([...copy.data]).toEqual([...pixels]);
  copy.data[0] = 99;
  expect(pixels[0]).toBe(12);
  expect(texture.source).toBe(source);
  texture.image.width = 2;
  expect(() => exportNormalMapPixels(texture)).toThrow("Unsupported raw export normal map");
});

it("shares temporary normal maps and material clones, then restores exact mesh references once", () => {
  const normalMap = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  const material = new MeshStandardMaterial({ normalMap }), other = new MeshStandardMaterial();
  const array = [material, other], first = new Mesh(new BoxGeometry(), array);
  const second = new Mesh(first.geometry, material), root = new Group(); root.add(first, second);
  const converted = new Texture(); let calls = 0, disposedTextures = 0, disposedMaterials = 0;
  converted.addEventListener("dispose", () => disposedTextures++);
  const prepared = prepareBuildingExportNormalMaps(root, () => { calls++; return converted; });
  expect(calls).toBe(1); expect(prepared.convertedMaterials).toBe(1);
  expect(first.material[0]).toBe(second.material);
  expect(first.material[1]).toBe(other);
  expect((second.material as MeshStandardMaterial).normalMap).toBe(converted);
  second.material.addEventListener("dispose", () => disposedMaterials++);
  expect(material.normalMap).toBe(normalMap);
  prepared.restore(); prepared.restore();
  expect(first.material).toBe(array); expect(second.material).toBe(material);
  expect(disposedMaterials).toBe(1); expect(disposedTextures).toBe(1);
});

it("restores already prepared meshes and disposes temporary resources if conversion fails", () => {
  const root = new Group(), first = new Mesh(new BoxGeometry(), new MeshStandardMaterial({
    normalMap: new DataTexture(new Uint8Array(4), 1, 1) }));
  const second = new Mesh(first.geometry, new MeshStandardMaterial({
    normalMap: new DataTexture(new Uint8Array(4), 1, 1) }));
  root.add(first, second); const original = first.material, converted = new Texture();
  let calls = 0, disposed = 0; converted.addEventListener("dispose", () => disposed++);
  expect(() => prepareBuildingExportNormalMaps(root, () => {
    if (++calls === 2) throw new Error("conversion failed");
    return converted;
  })).toThrow("conversion failed");
  expect(first.material).toBe(original); expect(disposed).toBe(1);
});

it("converts separate metal/rough maps while preserving channel data and deduplicating shared inputs", () => {
  const normal = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  const rough = new DataTexture(new Uint8Array([7, 81, 9, 255]), 1, 1);
  const material = new MeshStandardMaterial({ normalMap: normal, metalnessMap: normal, roughnessMap: rough });
  const mesh = new Mesh(new BoxGeometry(), material), created: Texture[] = [];
  const prepared = prepareBuildingExportNormalMaps(mesh, raw => {
    const texture = new Texture(); texture.userData.pixels = [...exportNormalMapPixels(raw).data];
    created.push(texture); return texture;
  });
  expect(prepared.convertedTextures).toBe(2);
  expect(mesh.material.normalMap).toBe(mesh.material.metalnessMap);
  expect(mesh.material.roughnessMap!.userData.pixels).toEqual([7, 81, 9, 255]);
  expect(created).toHaveLength(2); prepared.restore();
  expect(mesh.material).toBe(material); expect(material.metalnessMap).toBe(normal);
  expect(material.roughnessMap).toBe(rough);
});

it("identifies missing image ownership and slot without inventing replacement pixels", () => {
  const texture = new Texture(), material = new MeshStandardMaterial({ map: texture });
  const mesh = new Mesh(new BoxGeometry(), material), root = new Group(); root.add(mesh);
  root.userData.buildingId = 20; root.userData.nation = "indigenous";
  mesh.name = "indigenous_20_sign";
  expect(invalidBuildingExportTextures(root)).toEqual([expect.objectContaining({
    buildingId: 20, nation: "indigenous", mesh: "indigenous_20_sign", slot: "map", texture: texture.uuid,
    imageConstructor: null, width: null, height: null, dataLength: null, dataTexture: false
  })]);
  expect(texture.image).toBeNull(); expect(mesh.material).toBe(material);
});

it("rejects a mismatched exporter instance and restores the prototype after operation failure", async () => {
  const original = GLTFExporter.prototype.parseAsync;
  await expect(withBuildingExportNormalMaps(async () => "no exporter called"))
    .rejects.toThrow("did not use the guarded GLTFExporter instance");
  expect(GLTFExporter.prototype.parseAsync).toBe(original);
  const failure = async () => { throw new Error("official exporter failed"); };
  GLTFExporter.prototype.parseAsync = failure;
  try {
    const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial()), material = mesh.material;
    await expect(withBuildingExportNormalMaps(() => new GLTFExporter().parseAsync(mesh)))
      .rejects.toThrow("official exporter failed");
    expect(mesh.material).toBe(material);
    expect(GLTFExporter.prototype.parseAsync).toBe(failure);
  } finally { GLTFExporter.prototype.parseAsync = original; }
});
