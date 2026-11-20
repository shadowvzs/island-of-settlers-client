import { Mesh, MeshStandardMaterial, Triangle, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";
import { getBuildingStockLayout } from "../src/render-common/buildings/building-stock-layout";
import { getRomanWareStockSlots } from "../src/render-common/buildings/roman-ware-stock";
import { tanneryTableApproach } from "../src/render-common/buildings/tannery-table-contact";
import { stockWareDimensions } from "../src/render-common/buildings/ware-stock-envelope";
import { createWorkerHide } from "../src/renderers/three/worker-hide-transfer";
import { validateSavedActors } from "../src/shared/settlement/settlement-save-actors";

const nations = ["roman", "japanese", "chinese", "persian", "nubian", "indigenous", "viking", "maya"] as const;

describe("Tannery real tabletop and hanging-skin contact", () => {
  it("puts the entire canonical leather footprint on its real table, inset from the working edge", () => {
    for (const nation of nations) {
      const { recipe, scale } = getBuildingStockLayout(8, { nation });
      const slots = getRomanWareStockSlots(recipe,scale).filter(slot => slot.stock.ware === "leather");
      expect(slots).toHaveLength(6);
      for (const slot of slots) {
        const world = slot.center.map(value => value * scale) as [number,number,number];
        const approach = tanneryTableApproach(recipe,scale,world)!;
        expect(approach,`${nation}/${slot.stock.slot} ${JSON.stringify(world)}`).toBeDefined();
        const width = stockWareDimensions("leather",scale,slot.yaw,slot.horizontalSpan).size[0] * scale;
        const outside = world[0] + Math.sign(world[0]) * width / 2;
        expect(Math.abs(approach[0] - outside)).toBeCloseTo(.205 + .035,6);
      }
    }
    for (const nation of nations) {
      const {scale} = getBuildingStockLayout(8,{nation});
      for (const rotation of [0,1,2,3]) {
        const contact = getBuildingStockContact(8,"input","hides",0,12,18,rotation,7,undefined,undefined,{nation})!;
        expect(contact.presentation).toBe("hanging");
        expect(contact.wareScale).toEqual([scale,scale,scale]);
        expect(contact.warePosition[1]).toBeGreaterThan(7.7);
      }
    }
  });

  it("folds one continuous skin while keeping both barycentric palm anchors on actual mesh triangles", () => {
    const material = new MeshStandardMaterial();
    for (const detailed of [false,true]) {
      const prop = createWorkerHide(material,detailed);
      const mesh = prop.getObjectByName("ware_geometry")!.children[0] as Mesh;
      const geometry = mesh.geometry, position = geometry.getAttribute("position"), index = geometry.index!;
      const count = position.count, triangle = new Triangle(), nearest = new Vector3();
      for (const fold of [0,.25,.5,.75,1]) {
        prop.userData.foldHide(fold); expect(position.count).toBe(count);
        for (const anchor of prop.userData.hideGripTargets as Vector3[]) {
          let distance = Infinity;
          for (let at=0;at<index.count;at+=3) {
            triangle.a.fromBufferAttribute(position,index.getX(at));
            triangle.b.fromBufferAttribute(position,index.getX(at+1));
            triangle.c.fromBufferAttribute(position,index.getX(at+2));
            triangle.closestPointToPoint(anchor,nearest); distance=Math.min(distance,anchor.distanceTo(nearest));
          }
          expect(distance).toBeLessThan(1e-7);
        }
      }
      geometry.dispose();
    }
    material.dispose();
  });
  it("round-trips the optional presentation without changing quantity or handoff progress", () => {
    const actor = {uid:1,x:0,y:0,z:0,yaw:0,visible:true,job:"Tanner",phase:"inputPickup",path:[],pathIndex:0,
      timer:.4,animationTime:0,home:1,building:1,action:"carry",ware:"hides",consumed:{hides:1},
      wareTransfer:{direction:"pickup",ware:"hides",progress:.35,target:{x:1,y:.8,z:0},presentation:"hanging"}};
    const restored = JSON.parse(JSON.stringify(actor));
    expect(validateSavedActors([restored],new Set([1]),new Set())).toBeNull();
    expect(restored).toEqual(actor);
    restored.wareTransfer.presentation="unknown";
    expect(validateSavedActors([restored],new Set([1]),new Set())).toBe("Invalid handoff state");
    restored.stockContact={presentation:"invalid"};
    delete restored.wareTransfer.presentation;
    expect(validateSavedActors([restored],new Set([1]),new Set())).toBe("Invalid stock presentation");
    restored.stockContact.presentation="hanging";
    expect(validateSavedActors([restored],new Set([1]),new Set())).toBeNull();
  });

});
