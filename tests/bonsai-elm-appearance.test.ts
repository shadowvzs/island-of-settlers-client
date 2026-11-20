import { createHash } from "node:crypto";
import { Mesh, MeshStandardMaterial } from "three";
import { expect, it } from "vitest";

import { createBonsaiElmMaterials, VIVID_BONSAI_ELM_APPEARANCE } from "../src/renderers/three/plants/bonsai-elm-materials";
import { createBonsaiElmModel } from "../src/renderers/three/plants/bonsai-model";

it("uses the approved vivid palette by default, with bounded contrast gains and no emissive light", () => {
  const accepted = createBonsaiElmMaterials(undefined, undefined, { foliage: "#608348", barkLightness: 1 });
  const candidate = createBonsaiElmMaterials(undefined, undefined, VIVID_BONSAI_ELM_APPEARANCE);
  const production = createBonsaiElmMaterials();
  try {
    expect(accepted.materials.foliage.color.getHexString()).toBe("608348");
    const leaf = candidate.materials.foliage;
    expect(production.materials.foliage.color.toArray()).toEqual(leaf.color.toArray());
    expect(leaf.color.g).toBeGreaterThan(accepted.materials.foliage.color.g * 2);
    expect(leaf.color.g).toBeGreaterThan(leaf.color.r * 2);
    expect(leaf.color.g).toBeGreaterThan(leaf.color.b * 5);
    const oldMap = (accepted.materials.bark.map!.image as { data: Uint8Array }).data;
    const newMap = (candidate.materials.bark.map!.image as { data: Uint8Array }).data;
    const productionMap = (production.materials.bark.map!.image as { data: Uint8Array }).data;
    expect(productionMap.every((value, index) => value === newMap[index])).toBe(true);
    let oldLightness = 0, newLightness = 0;
    for (let pixel = 0; pixel < oldMap.length; pixel += 4) {
      oldLightness += oldMap[pixel]! + oldMap[pixel + 1]! + oldMap[pixel + 2]!;
      newLightness += newMap[pixel]! + newMap[pixel + 1]! + newMap[pixel + 2]!;
      expect(newMap[pixel + 3]).toBe(oldMap[pixel + 3]);
    }
    expect(newLightness / oldLightness).toBeGreaterThan(1.24);
    expect(newLightness / oldLightness).toBeLessThan(1.26);
    const oldNormal = (accepted.materials.bark.normalMap!.image as { data: Uint8Array }).data;
    const newNormal = (candidate.materials.bark.normalMap!.image as { data: Uint8Array }).data;
    expect(newNormal.every((value, index) => value === oldNormal[index])).toBe(true);
    for (const material of Object.values(candidate.materials)) {
      expect(material).toBeInstanceOf(MeshStandardMaterial);
      expect(material.emissive.getHex()).toBe(0); expect(material.toneMapped).toBe(true);
    }
  } finally { accepted.dispose(); candidate.dispose(); production.dispose(); }
});

it.each([true, false])("preserves every accepted geometry buffer, form and corrected left branch; High=%s", detailed => {
  const accepted = createBonsaiElmMaterials();
  const candidate = createBonsaiElmMaterials(undefined, undefined, VIVID_BONSAI_ELM_APPEARANCE);
  const first = createBonsaiElmModel(accepted.materials, detailed, 1);
  const second = createBonsaiElmModel(candidate.materials, detailed, 1);
  const hash = (model: typeof first) => model.root.children.map(child => {
    const geometry = (child as Mesh).geometry, digest = createHash("sha256");
    for (const name of Object.keys(geometry.attributes).sort((a, b) => a.localeCompare(b))) {
      const values = geometry.getAttribute(name).array;
      digest.update(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
    }
    if (geometry.index) digest.update(new Uint8Array(geometry.index.array.buffer));
    return digest.digest("hex");
  });
  try {
    expect(hash(second)).toEqual(hash(first)); expect(second.graph).toEqual(first.graph);
    expect(second.triangles).toBe(detailed ? 9710 : 4818);
  } finally { first.dispose(); second.dispose(); accepted.dispose(); candidate.dispose(); }
});
