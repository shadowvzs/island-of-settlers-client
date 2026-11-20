import * as three from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import * as bridge from "./building-export-normal-maps";

export const runExportNormalFixture = async () => {
    const pixels = new Uint8Array([120, 80, 240, 255, 130, 110, 250, 255,
      140, 140, 230, 255, 150, 170, 220, 255]);
    const normal = new three.DataTexture(pixels, 2, 2); normal.needsUpdate = true;
    const material = new three.MeshStandardMaterial({ normalMap: normal }); material.normalScale.set(.4, .4);
    const mesh = new three.Mesh(new three.BoxGeometry(), material), exporter = new GLTFExporter();
    let controlError = "";
    try { await exporter.parseAsync(mesh, { binary: true }); }
    catch (error) { controlError = String(error); }
    if (!controlError.includes("CanvasImageSource") && !controlError.includes("drawImage"))
      throw new Error(`Raw normal-map control did not reproduce the failure: ${controlError}`);
    const metalPixels = new Uint8Array([3, 5, 40, 255, 7, 9, 80, 255,
      11, 13, 120, 255, 15, 17, 160, 255]);
    const roughPixels = new Uint8Array([19, 50, 21, 255, 23, 90, 25, 255,
      27, 130, 29, 255, 31, 170, 33, 255]);
    const metalness = new three.DataTexture(metalPixels, 2, 2);
    const roughness = new three.DataTexture(roughPixels, 2, 2);
    const metalControl = new three.Mesh(mesh.geometry, new three.MeshStandardMaterial({
      metalnessMap: metalness, roughnessMap: roughness }));
    let metalControlError = "";
    try { await exporter.parseAsync(metalControl, { binary: true }); }
    catch (error) { metalControlError = String(error); }
    if (!metalControlError.includes("drawImage")) throw new Error("Raw metal/rough control did not reproduce failure");
    material.metalnessMap = metalness; material.roughnessMap = roughness;
    const source = normal.source, originalParse = GLTFExporter.prototype.parseAsync;
    const buffer = await bridge.withBuildingExportNormalMaps(() => exporter.parseAsync(mesh, { binary: true }));
    if (mesh.material !== material || material.normalMap !== normal || normal.source !== source ||
      material.metalnessMap !== metalness || material.roughnessMap !== roughness ||
      GLTFExporter.prototype.parseAsync !== originalParse) throw new Error("Export references were not restored");
    if (!(buffer instanceof ArrayBuffer)) throw new Error("Exporter did not produce a binary GLB");
    const loaded = await new GLTFLoader().parseAsync(buffer, "");
    const loadedMaterial = (loaded.scene.children[0] as three.Mesh).material as three.MeshStandardMaterial;
    if (!loadedMaterial.normalMap || Math.abs(loadedMaterial.normalScale.x - .4) > 1e-6 ||
      Math.abs(loadedMaterial.normalScale.y + .4) > 1e-6) throw new Error("Normal-map channel convention changed");
    const canvas = document.createElement("canvas"); canvas.width = 2; canvas.height = 2;
    const context = canvas.getContext("2d")!;
    context.drawImage(loadedMaterial.normalMap.image as CanvasImageSource, 0, 0);
    const decoded = [...context.getImageData(0, 0, 2, 2).data];
    const expected = [...pixels].map((value, index) => index % 4 === 1 ? 255 - value : value);
    if (decoded.some((value, index) => value !== expected[index]))
      throw new Error(`Normal texture pixels differ: ${decoded.join(",")} vs ${expected.join(",")}`);
    if (!loadedMaterial.metalnessMap || !loadedMaterial.roughnessMap)
      throw new Error("Metalness/roughness maps missing after official reload");
    context.drawImage(loadedMaterial.metalnessMap.image as CanvasImageSource, 0, 0);
    const mergedPixels = [...context.getImageData(0, 0, 2, 2).data];
    const expectedMerged = [...metalPixels].map((value, index) => {
      if (index % 4 === 1) return roughPixels[index]!;
      if (index % 4 === 2) return value;
      return index % 4 === 3 ? 255 : 0;
    });
    if (mergedPixels.some((value, index) => value !== expectedMerged[index]))
      throw new Error(`Metal/rough channel data differ: ${mergedPixels.join(",")}`);
    return { passed: true, controlError, metalControlError, glbBytes: buffer.byteLength, decoded, expected,
      mergedPixels, expectedMerged,
      originalReferencesRestored: true, normalScale: loadedMaterial.normalScale.toArray() };
};
