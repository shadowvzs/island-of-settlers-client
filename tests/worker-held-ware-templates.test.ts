import { type BufferGeometry, Mesh, MeshStandardMaterial, type Object3D } from "three";
import { expect, it } from "vitest";

import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { WARE_IDS } from "../src/render-common/wares/ware-catalog";
import { createWareModel } from "../src/renderers/three/settlement/ware-models";
import { acquireHeldWareClone, heldWareTemplateCount } from "../src/renderers/three/worker-held-ware-templates";
import { createWorkerWellBucket } from "../src/renderers/three/worker-well-bucket";

const materials = new Proxy({} as Record<BuildingSurface, MeshStandardMaterial>, {
  get: (cache, name: string) => (cache as Record<string, MeshStandardMaterial>)[name] ??= new MeshStandardMaterial()
});

const geometries = (root: { traverse: (visit: (object: unknown) => void) => void }) => {
  const found: BufferGeometry[] = [];
  root.traverse(object => { if (object instanceof Mesh) found.push(object.geometry); });
  return found;
};

/** GPU-LIFECYCLE-03: bodies share one geometry per held ware instead of one copy per body. */
it("clones every carried ware from one shared template and frees it with the last clone", () => {
  for (const ware of WARE_IDS) {
    if (ware === "hides") continue;
    let disposed = 0;
    const create = () => createWareModel(ware, true, materials, "carry").root;
    const free = () => { disposed++; };
    const first = acquireHeldWareClone(`test:${ware}`, create, free);
    const second = acquireHeldWareClone(`test:${ware}`, create, free);
    expect(geometries(second)).toEqual(geometries(first));
    first.userData.releaseHeldWare();
    first.userData.releaseHeldWare();
    expect(disposed).toBe(0);
    second.userData.releaseHeldWare();
    expect(disposed).toBe(1);
  }
  expect(heldWareTemplateCount()).toBe(0);
});

it("shares the well bucket and releases its own water material only with the template", () => {
  let released = 0;
  const create = () => {
    const bucket = createWorkerWellBucket(materials, true);
    const water = bucket.userData.disposeOwnedMaterials;
    bucket.userData.disposeOwnedMaterials = () => { released++; water(); };
    return bucket;
  };
  const free = (root: Object3D) => root.userData.disposeOwnedMaterials();
  const first = acquireHeldWareClone("test:well", create, free);
  const second = acquireHeldWareClone("test:well", create, free);
  expect(geometries(second)).toEqual(geometries(first));
  first.userData.releaseHeldWare();
  expect(released).toBe(0);
  second.userData.releaseHeldWare();
  expect(released).toBe(1);
});
