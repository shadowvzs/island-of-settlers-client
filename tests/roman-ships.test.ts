import { Box3, type BufferAttribute, type BufferGeometry, CatmullRomCurve3, Mesh, MeshStandardMaterial as importMaterial, Ray,Triangle, TubeGeometry, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { SAILING_SHIP_OVERALL_BEAM, SAILING_SHIP_OVERALL_LENGTH } from "../src/render-common/ships/ship-dimensions";
import { createShipClothWind } from "../src/renderers/three/settlement/ship-cloth-wind";
import { createThreeSettlementShips, SHIP_RIGGING_ROPES } from "../src/renderers/three/settlement/three-ships";
import { deformShipCloth, SHIP_CLOTH_TEST_WINDS } from "./helpers/ship-cloth-deform";
import { visibleMeshBounds } from "./helpers/visible-mesh-bounds";

const ship = { id: 1, x: 0, y: 0, z: 0, yaw: 0, phase: "idle" as const, cargoCount: 0 };

describe("Roman transport ship rendering", () => {
  it.each(["high", "minimal"] as const)("keeps %s enlarged ships in their shared navigation envelope", quality => {
    const layer = createThreeSettlementShips(quality);
    layer.update([ship], [], 0);
    expect(layer.group.children[0]!.scale.x).toBe(4);
    // Only what is drawn counts: the hidden figureheads of other nations are not part of this ship.
    const dimensions = visibleMeshBounds(layer.group).getSize(new Vector3());
    expect(dimensions.x).toBeLessThanOrEqual(SAILING_SHIP_OVERALL_BEAM);
    expect(dimensions.z).toBeLessThanOrEqual(SAILING_SHIP_OVERALL_LENGTH);
    layer.group.traverseVisible(object => {
      if (!(object instanceof Mesh)) return;
      expect(object.geometry.attributes.position!.count).toBeGreaterThan(0);
      expect(object.geometry.attributes.uv!.count).toBe(object.geometry.attributes.position!.count);
    });
    layer.update([], [{ id: 2, x: 0, y: 0, z: 0, yaw: 0, progress: 1, kind: "boat", scale: .3 }], 1);
    expect(layer.group.children[0]!.scale.x).toBe(.3);
    layer.dispose();
  });
  it("reuses static batches when completed ships leave and new construction starts", () => {
    const layer = createThreeSettlementShips("high");
    const geometries = () => {
      const ids: string[] = [];
      layer.group.traverse(object => { if (object instanceof Mesh) ids.push(object.geometry.uuid); });
      return ids;
    };
    layer.update([ship], [], 0);
    const first = geometries();
    for (let tick = 1; tick < 12; tick++) {
      layer.update([], [], tick);
      layer.update([{ ...ship, id: tick + 1 }], [], tick);
      expect(geometries()).toEqual(first);
    }
    layer.dispose();
    expect(layer.group.children).toHaveLength(0);
  });
});


it("keeps actual rope tube triangles clear of the wind-blown cloth in every wind", () => {
  const layer = createThreeSettlementShips("high", undefined, undefined, createShipClothWind());
  const ropes = SHIP_RIGGING_ROPES.map(points =>
    new TubeGeometry(new CatmullRomCurve3(points.map(p => new Vector3(p[0]!,p[1]!,p[2]!))),4,.005,6));
  const triangles = (geometry: BufferGeometry, positions = geometry.getAttribute("position")) => {
    const index=geometry.index!, result: Triangle[]=[];
    for(let i=0;i<index.count;i+=3) result.push(new Triangle(...[0,1,2].map(j=>
      new Vector3().fromBufferAttribute(positions,index.getX(i+j))) as [Vector3,Vector3,Vector3]));
    return result;
  };
  const ropeTriangles=ropes.flatMap(rope => triangles(rope)).map(triangle=>
    ({triangle,bounds:new Box3().setFromPoints([triangle.a,triangle.b,triangle.c])}));
  const ray=new Ray(), hit=new Vector3();
  const edgesPierce=(a: Triangle,b: Triangle) => {
    const corners=[a.a,a.b,a.c];
    for(let i=0;i<3;i++) {
      const start=corners[i]!,end=corners[(i+1)%3]!,length=start.distanceTo(end);
      ray.set(start,end.clone().sub(start).normalize());
      if(ray.intersectTriangle(b.a,b.b,b.c,false,hit)&&start.distanceTo(hit)>1e-6&&start.distanceTo(hit)<length-1e-6)
        return true;
    }
    return false;
  };
  layer.update([ship],[],0);
  let cloth: BufferGeometry | undefined;
  layer.group.traverse(object=>{
    if(object instanceof Mesh&&object.material instanceof importMaterial&&object.name==="ship_sail")cloth=object.geometry;
  });
  expect(cloth).toBeDefined();
  const blown = (cloth!.getAttribute("position") as BufferAttribute).clone();
  for(const [state, wind] of SHIP_CLOTH_TEST_WINDS.entries()) {
    for(const textile of triangles(cloth!, deformShipCloth(cloth!, wind, blown))) {
      const bounds=new Box3().setFromPoints([textile.a,textile.b,textile.c]);
      for(const rope of ropeTriangles)if(bounds.intersectsBox(rope.bounds))
        expect(edgesPierce(textile,rope.triangle)||edgesPierce(rope.triangle,textile),`wind ${state}`).toBe(false);
    }
  }
  ropes.forEach(geometry=>geometry.dispose());layer.dispose();
});
