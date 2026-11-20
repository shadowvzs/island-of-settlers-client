import { writeFileSync } from "node:fs";
import { DoubleSide, FrontSide, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Vector2, Vector3 } from "three";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { leveledBuildingRecipe } from "../../src/render-common/buildings/levels/leveled-building-recipe";
import { createChinesePanCoverRoof } from "../../src/renderers/three/buildings/chinese-pan-cover-roof";

// The actual native-e macro camera, expressed in the model root's local coordinates.
const camera = new PerspectiveCamera(36, 768 / 640, .1, 60);
camera.position.set(.72 + 1.3, 1.09 + .65, -.80 - 1.9);
camera.lookAt(new Vector3(.72, 1.09, -.80)); camera.updateMatrixWorld(true);
const doubleSided = process.argv.includes("--double-sided");
const pixels = [[550, 275], [560, 276], [540, 276], [520, 278], [530, 302], [550, 303], [540, 308], [500, 310], [340, 53], [300, 38], [218, 365]];
const output = [];
for (const detailed of [true, false]) {
  const recipe = leveledBuildingRecipe(getBuildingDefinition(37), "chinese", detailed, 5);
  const material = new MeshBasicMaterial({ side: doubleSided ? DoubleSide : FrontSide });
  const roofs = recipe.parts.filter(part => part.shape === "occupation-roof").map((part, index) => {
    const mesh = new Mesh(createChinesePanCoverRoof(part, detailed), material);
    mesh.scale.set(...part.size); mesh.position.set(...part.position);
    if (part.rotation) mesh.rotation.set(...part.rotation);
    mesh.updateMatrixWorld(true); mesh.userData = { part, roofIndex: index }; return mesh;
  });
  for (const pixel of pixels) {
    const ray = new Raycaster(); ray.setFromCamera(new Vector2(pixel[0]! / 768 * 2 - 1, 1 - pixel[1]! / 640 * 2), camera);
    const hit = ray.intersectObjects(roofs)[0];
    if (!hit?.face) { output.push({ detailed, pixel, hit: null }); continue; }
    const mesh = hit.object as Mesh, position = mesh.geometry.getAttribute("position");
    const colour = mesh.geometry.getAttribute("color"), face = hit.face;
    const vertices = [face.a, face.b, face.c].map(id => new Vector3().fromBufferAttribute(position, id));
    const faceNormal = vertices[1]!.clone().sub(vertices[0]!).cross(vertices[2]!.clone().sub(vertices[0]!)).normalize();
    output.push({ detailed, pixel, roofIndex: mesh.userData.roofIndex, part: mesh.userData.part,
      point: hit.point.toArray(), normal: faceNormal.toArray(), colour: colour.getX(face.a),
      vertices: vertices.map(vertex => vertex.toArray()), triangle: hit.faceIndex });
  }
  roofs.forEach(mesh => mesh.geometry.dispose()); material.dispose();
}
writeFileSync(`/tmp/chinese-roof-facet-attribution${doubleSided ? "-double" : "-front"}.json`, JSON.stringify(output, null, 2));
console.log(JSON.stringify(output.map(({ colour, detailed, hit, normal, pixel, point, roofIndex, triangle }) =>
  ({ colour, detailed, hit, normal, pixel, point, roofIndex, triangle })), null, 2));
