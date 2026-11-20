import {
  type BufferGeometry, Color, Float32BufferAttribute, Group, InstancedMesh,
  type Material, Matrix4, Mesh, type Object3D, SRGBColorSpace
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

interface TemplateSource { root: Object3D; dispose: () => void }
interface Surface { geometry: BufferGeometry; material: Material; palette: boolean }

/** Flatten nested botanical instances ONCE, then share those whole-template surfaces across placements. */
export const createWisteriaPopulationTemplates = (source: TemplateSource,
  paletteMesh: (mesh: Mesh) => boolean) => {
  source.root.updateMatrixWorld(true);
  const inverse = source.root.matrixWorld.clone().invert(), world = new Matrix4(), instance = new Matrix4();
  const groups = new Map<string, { material: Material; palette: boolean; parts: BufferGeometry[] }>(), colour = new Color();
  source.root.traverse(node => {
    if (!(node instanceof Mesh)) return;
    if (Array.isArray(node.material)) throw new Error("Wisteria population requires canonical single-surface meshes");
    const palette = paletteMesh(node), key = `${node.material.uuid}:${palette}`;
    const group: { material: Material; palette: boolean; parts: BufferGeometry[] } = groups.get(key) ?? { material: node.material, palette, parts: [] };
    const parts = group.parts;
    const instances = node instanceof InstancedMesh ? node.count : 1;
    for (let index = 0; index < instances; index++) {
      world.copy(inverse).multiply(node.matrixWorld);
      if (node instanceof InstancedMesh) { node.getMatrixAt(index, instance); world.multiply(instance); }
      const geometry = node.geometry.clone();
      for (const key of Object.keys(geometry.attributes))
        if (!["position", "normal", "uv", "color"].includes(key)) geometry.deleteAttribute(key);
      const count = geometry.getAttribute("position").count;
      if (!geometry.getAttribute("color"))
        geometry.setAttribute("color", new Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3));
      if (!geometry.index) geometry.setIndex(Array.from({ length: count }, (_, vertex) => vertex));
      const colours = geometry.getAttribute("color");
      if (node instanceof InstancedMesh && node.instanceColor) {
        node.getColorAt(index, colour);
        for (let vertex = 0; vertex < count; vertex++)
          colours.setXYZ(vertex, colours.getX(vertex) * colour.r,
            colours.getY(vertex) * colour.g, colours.getZ(vertex) * colour.b);
      }
      geometry.applyMatrix4(world); parts.push(geometry);
    }
    groups.set(key, group);
  });
  const surfaces: Surface[] = [];
  for (const { material, palette, parts } of groups.values()) {
    if (!parts.length) continue;
    const geometry = mergeGeometries(parts);
    parts.forEach(part => part.dispose());
    if (!geometry) throw new Error("Wisteria population surface merge failed");
    surfaces.push({ geometry, material, palette });
  }
  let disposed = false;
  const live = new Set<{ dispose: () => void }>();
  const createTemplate = () => {
    if (disposed) throw new Error("Wisteria population templates are disposed");
    const root = new Group();
    for (const surface of surfaces) {
      const mesh = new Mesh(surface.geometry, surface.material);
      mesh.name = surface.palette ? "paint" : "wisteria_fixed_surface";
      root.add(mesh);
    }
    let released = false;
    const template = { root, dispose: () => {
      if (released) return;
      released = true; root.removeFromParent(); root.clear(); live.delete(template);
    } };
    live.add(template); return template;
  };
  const create = (count: number) => {
    if (disposed || !Number.isSafeInteger(count) || count < 1) throw new Error("Invalid Wisteria population size");
    const root = new Group(), meshes = surfaces.map(surface => {
      const mesh = new InstancedMesh(surface.geometry, surface.material, count);
      mesh.name = surface.palette ? "wisteria_population_neutral_flowers" : "wisteria_population_fixed_surface";
      mesh.castShadow = false; mesh.receiveShadow = true; root.add(mesh); return mesh;
    });
    let released = false;
    const batch = { root, set: (index: number, matrix: Matrix4,
      palette: readonly [number, number, number] = [1, 1, 1]) => {
      if (released || !Number.isSafeInteger(index) || index < 0 || index >= count) throw new Error("Invalid Wisteria placement index");
      meshes.forEach((mesh, surface) => {
        mesh.setMatrixAt(index, matrix);
        if (surfaces[surface]!.palette) {
          colour.setRGB(...palette, SRGBColorSpace); mesh.setColorAt(index, colour);
        }
      });
    }, commit: () => {
      if (released) return;
      for (const mesh of meshes) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingBox(); mesh.computeBoundingSphere();
      }
    }, dispose: () => {
      if (released) return; released = true;
      meshes.forEach(mesh => mesh.dispose()); root.removeFromParent(); root.clear(); live.delete(batch);
    } };
    live.add(batch); return batch;
  };
  return { create, createTemplate, surfaces: surfaces.length,
    triangles: surfaces.reduce((sum, surface) => sum + surface.geometry.index!.count / 3, 0),
    dispose: () => {
      if (disposed) return; disposed = true;
      for (const batch of live) batch.dispose();
      surfaces.forEach(surface => surface.geometry.dispose()); source.dispose();
    } };
};
