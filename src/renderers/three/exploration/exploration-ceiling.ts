import { Box3, type Mesh, type Object3D, type Quaternion, Raycaster, Vector3 } from "three";

import { BUILDING_BATCH_SOURCE_LAYER } from "../buildings/building-static-batches";

const CELL = 8;
const visible = (object: Object3D | null): boolean => !object || (object.visible && visible(object.parent));
type Entry = { root: Object3D; position: Vector3; quaternion: Quaternion; scale: Vector3;
  bounds: Box3; meshes: Mesh[]; cells: string[] };

/** Placed structures only: no crowd, transient avatar, loose stock, map-wide scene traversal or idle rays. */
export const createExplorationCeilingQuery = () => {
  const entries = new Map<string, Entry>(), cells = new Map<string, Set<string>>();
  const ray = new Raycaster(new Vector3(), new Vector3(0, 1, 0));
  // Batched building parts are hidden from cameras only; ceilings still stop the eye under them.
  ray.layers.enable(BUILDING_BATCH_SOURCE_LAYER);
  let queries = 0, candidates = 0, rays = 0;
  const remove = (id: string) => {
    const entry = entries.get(id);
    if (!entry) return;
    for (const key of entry.cells) {
      const bucket = cells.get(key); bucket?.delete(id);
      if (!bucket?.size) cells.delete(key);
    }
    entries.delete(id);
  };
  const sync = (id: string, root: Object3D) => {
    const old = entries.get(id);
    if (old?.root === root && old.position.equals(root.position) && old.quaternion.equals(root.quaternion) &&
      old.scale.equals(root.scale)) return;
    remove(id); root.updateWorldMatrix(true, true);
    const meshes: Mesh[] = [];
    root.traverse(object => {
      const mesh = object as Mesh & { isSkinnedMesh?: boolean };
      if (!mesh.isMesh || mesh.isSkinnedMesh ||
        object.userData.stock || object.userData.canonicalStock || object.userData.liveAnimalGeometry ||
        object.userData.catapultRockMaterial || object.name.startsWith("ware_")) return;
      meshes.push(mesh);
    });
    const bounds = new Box3(), part = new Box3(), keys: string[] = [];
    for (const mesh of meshes) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      bounds.union(part.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld));
    }
    if (!bounds.isEmpty()) for (let z = Math.floor(bounds.min.z / CELL); z <= Math.floor(bounds.max.z / CELL); z++)
      for (let x = Math.floor(bounds.min.x / CELL); x <= Math.floor(bounds.max.x / CELL); x++) {
        const key = `${x},${z}`, bucket = cells.get(key) ?? new Set<string>();
        bucket.add(id); cells.set(key, bucket); keys.push(key);
      }
    entries.set(id, { root, position: root.position.clone(), quaternion: root.quaternion.clone(),
      scale: root.scale.clone(), bounds, meshes, cells: keys });
  };
  return {
    sync, remove,
    invalidate: (id: string, root: Object3D) => { if (entries.get(id)?.root === root) remove(id); },
    sample: (x: number, z: number, floor: number, radius: number, reach: number) => {
      queries++;
      const nearby = new Set<string>();
      for (let cz = Math.floor((z - radius) / CELL); cz <= Math.floor((z + radius) / CELL); cz++)
        for (let cx = Math.floor((x - radius) / CELL); cx <= Math.floor((x + radius) / CELL); cx++)
          for (const id of cells.get(`${cx},${cz}`) ?? []) nearby.add(id);
      let ceiling = Infinity;
      for (const id of nearby) {
        const entry = entries.get(id)!;
        if (!visible(entry.root) || entry.bounds.max.x < x - radius || entry.bounds.min.x > x + radius ||
          entry.bounds.max.z < z - radius || entry.bounds.min.z > z + radius ||
          entry.bounds.max.y < floor || entry.bounds.min.y > floor + reach) continue;
        candidates++;
        const meshes = entry.meshes.filter(mesh => visible(mesh));
        for (const [dx, dz] of [[0, 0], [-radius, 0], [radius, 0], [0, -radius], [0, radius]]) {
          ray.ray.origin.set(x + dx!, floor + .001, z + dz!); ray.near = 0; ray.far = reach;
          rays++;
          const hit = ray.intersectObjects(meshes, false)[0];
          if (hit) ceiling = Math.min(ceiling, hit.point.y);
        }
      }
      return ceiling;
    },
    stats: () => ({ queries, candidates, rays, structures: entries.size }),
    clear: () => { entries.clear(); cells.clear(); }
  };
};
