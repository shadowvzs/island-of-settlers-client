import { type BufferGeometry, Color, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Object3D, OctahedronGeometry, SRGBColorSpace, type Texture, Vector3 } from "three";

import type { WisteriaFlowerInstance, WisteriaLeafInstance } from "../../render-common/wisteria-hero-graph";
import { mapWisteriaBudAtlas, mapWisteriaFlowerAtlas, mapWisteriaLeafAtlas } from "./wisteria-botanical-atlas-geometry";
import { createWisteriaBotanicalMaterials } from "./wisteria-botanical-materials";
import { createWisteriaFlowerGeometry } from "./wisteria-flower-geometry";
import { createWisteriaLeafGeometry } from "./wisteria-leaf-geometry";

export type { WisteriaFlowerInstance, WisteriaLeafInstance } from "../../render-common/wisteria-hero-graph";

/** Renderer-owned expensive neutral surfaces, reusable by the hero arch and the standalone tree. */
export const createWisteriaBotanicalTemplates = (options: { neutralAtlas?: boolean; lean?: boolean; atlasTexture?: Texture } = {}) => {
  const materials = createWisteriaBotanicalMaterials(options), flower = createWisteriaFlowerGeometry(options.lean);
  const leaf = createWisteriaLeafGeometry(options.lean), bud = new OctahedronGeometry(1, 0);
  bud.setAttribute("color", new Float32BufferAttribute(new Float32Array(bud.getAttribute("position").count * 3).fill(1), 3));
  bud.scale(.13, .31, .13); bud.translate(0, -.10, .02);
  if (options.neutralAtlas) {
    mapWisteriaFlowerAtlas(flower.petals); mapWisteriaLeafAtlas(leaf); mapWisteriaBudAtlas(bud);
  }
  const transform = new Object3D(), colour = new Color(), up = new Vector3(0, 1, 0), direction = new Vector3();
  const leafRight = new Vector3(), leafNormal = new Vector3(), leafBasis = new Matrix4();
  const live = new Set<Group>(); let disposed = false;
  const mesh = (geometry: BufferGeometry, material: typeof materials.petal, count: number) => {
    const result = new InstancedMesh(geometry, material, count);
    result.castShadow = true; result.receiveShadow = true; return result;
  };
  const finish = (root: Group) => {
    root.traverse(node => { if (node instanceof InstancedMesh) {
      node.instanceMatrix.needsUpdate = true;
      if (node.instanceColor) node.instanceColor.needsUpdate = true;
      node.computeBoundingBox(); node.computeBoundingSphere();
    } });
    live.add(root); let released = false;
    return { root, dispose: () => {
      if (released) return; released = true;
      root.traverse(node => { if (node instanceof InstancedMesh) node.dispose(); });
      root.removeFromParent(); root.clear(); live.delete(root);
    } };
  };
  const instantiate = (flowers: readonly WisteriaFlowerInstance[], leaves: readonly WisteriaLeafInstance[],
    palette: readonly [number, number, number] = [.75, .62, .92]) => {
    if (disposed) throw new Error("Botanical Wisteria templates are disposed");
    const root = new Group(), open = flowers.filter(instance => !instance.bud), closed = flowers.filter(instance => instance.bud);
    const petals = mesh(flower.petals, materials.petal, open.length);
    const throats = mesh(flower.throat, materials.throat, open.length);
    const calyces = mesh(flower.calyx, materials.calyx, flowers.length);
    const buds = mesh(bud, materials.petal, closed.length), foliage = mesh(leaf, materials.leaf, leaves.length);
    petals.name = "wisteria_open_petals"; calyces.name = "wisteria_calyces";
    buds.name = "wisteria_closed_buds"; foliage.name = "wisteria_pinnate_leaflets";
    throats.name = "wisteria_pale_throats";
    flowers.forEach((instance, index) => {
      transform.position.set(...instance.position); transform.rotation.set(instance.tilt ?? .8, instance.yaw, 0);
      transform.scale.setScalar(instance.scale); transform.updateMatrix(); calyces.setMatrixAt(index, transform.matrix);
    });
    for (const [instances, target] of [[open, petals], [closed, buds]] as const)
      instances.forEach((instance, index) => {
        transform.position.set(...instance.position); transform.rotation.set(instance.tilt ?? .8, instance.yaw, 0);
        transform.scale.setScalar(instance.scale); transform.updateMatrix(); target.setMatrixAt(index, transform.matrix);
        if (target === petals) throats.setMatrixAt(index, transform.matrix);
        const variation = .95 + (index % 5) * .012;
        colour.setRGB(palette[0] * variation, palette[1] * variation, palette[2] * variation, SRGBColorSpace);
        target.setColorAt(index, colour);
      });
    leaves.forEach((instance, index) => {
      transform.position.set(...instance.position); direction.set(...instance.direction).normalize();
      leafRight.crossVectors(direction, up);
      if (leafRight.lengthSq() < .0001) leafRight.set(1, 0, 0); else leafRight.normalize();
      leafNormal.crossVectors(leafRight, direction).normalize(); leafBasis.makeBasis(leafRight, direction, leafNormal);
      transform.quaternion.setFromRotationMatrix(leafBasis); transform.rotateY(instance.roll ?? 0);
      transform.scale.setScalar(instance.length); transform.updateMatrix(); foliage.setMatrixAt(index, transform.matrix);
      colour.setRGB(.29 * instance.shade, .46 * instance.shade, .16 * instance.shade, SRGBColorSpace);
      foliage.setColorAt(index, colour);
    });
    root.add(petals, throats, calyces, buds, foliage); return finish(root);
  };
  return { materials, instantiate, dispose: () => {
    if (disposed) return; disposed = true;
    for (const root of live) { root.traverse(node => { if (node instanceof InstancedMesh) node.dispose(); }); root.removeFromParent(); root.clear(); }
    live.clear(); flower.dispose(); leaf.dispose(); bud.dispose(); materials.dispose();
  } };
};
