import { Mesh, type MeshStandardMaterial,Vector3 } from "three";

import type { WorkerNation } from "../../../render-common/workers/worker-nation";
import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import { createWareRecipe } from "../../../render-common/wares/ware-recipe";
import { handledWaterBucketScale,WATER_STOCK_CENTER_Y, WATER_WARE_SCALE } from "../../../render-common/wares/water-bucket-dimensions";
import { disposeMeshGeometries } from "../three-mesh-resources";
import { createWorkerWellBucket } from "../worker-well-bucket";

/** The unchanged original handled bucket, at the established well-output physical size. */
export const createRomanWaterStock = (
  materials: Record<BuildingSurface, MeshStandardMaterial>, detailed: boolean, groundedMinimal = false, nation: WorkerNation = "roman"
) => {
  const root = createWorkerWellBucket(materials, detailed, true, nation);
  const shape = root.getObjectByName("ware_geometry")!;
  const scale = handledWaterBucketScale(WATER_WARE_SCALE);
  shape.scale.set(scale.x, scale.y, scale.z);
  shape.position.y = WATER_STOCK_CENTER_Y * WATER_WARE_SCALE.y - .041 * scale.y;
  if(groundedMinimal && !detailed) {
    // Grounded bucket undersides cannot be seen at RTS camera angles; keep the rim, water and handle.
    root.updateMatrixWorld(true);
    root.traverse(object=>{
      if(!(object instanceof Mesh)||!object.geometry.index)return;
      const geometry=object.geometry,indices=Array.from(geometry.index!.array) as number[],position=geometry.getAttribute("position"),kept:number[]=[];
      const a=new Vector3(),b=new Vector3(),c=new Vector3();
      for(let i=0;i<indices.length;i+=3) {
        a.fromBufferAttribute(position,indices[i]!).applyMatrix4(object.matrixWorld);
        b.fromBufferAttribute(position,indices[i+1]!).applyMatrix4(object.matrixWorld);
        c.fromBufferAttribute(position,indices[i+2]!).applyMatrix4(object.matrixWorld);
        const normal=b.sub(a).cross(c.sub(a)).normalize();
        if(normal.y>=-.05)kept.push(indices[i]!,indices[i+1]!,indices[i+2]!);
      }
      geometry.setIndex(kept);
    });
  }
  const dispose = () => {
    disposeMeshGeometries(root);
    root.userData.disposeOwnedMaterials?.(); root.removeFromParent();
  };
  const triangles = () => {
    let total = 0;
    root.traverse(object => { if (object instanceof Mesh)
      total += (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3; });
    return total;
  };
  return { root, recipe: createWareRecipe("water", detailed), dispose, triangles };
};
