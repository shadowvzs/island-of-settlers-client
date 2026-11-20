import { DataTexture, Mesh } from "three";
import { describe, expect, it } from "vitest";

import type { BakedSprites } from "../src/render-common/baker/prop-baker";
import type { PropInstances } from "../src/render-common/props/prop-instances";
import { getMeshId } from "../src/render-common/props/prop-meshes";
import { createDeferredImpostors } from "../src/renderers/three/three-deferred-impostors";
import { createImpostors, isImpostorKind } from "../src/renderers/three/three-impostors";
const instances = (): PropInstances => ({count:1,meshIds:Uint16Array.of(getMeshId(3,0)),
  sourceIndex:Int32Array.of(42), fog:Float32Array.of(2),phase:Float32Array.of(.1),
  rotation:Float32Array.of(0),scale:Float32Array.of(2),stretch:Float32Array.of(1.5),
  sunVisibility:Float32Array.of(1),tint:Float32Array.of(.8,.9,1),
  x:Float32Array.of(0),y:Float32Array.of(0),z:Float32Array.of(0)});
const baked = ():BakedSprites => {
  const sprites=[];
  sprites[getMeshId(3,0)]={width:10,height:20,pivotX:5,pivotY:18,u0:0,v0:0,u1:1,v1:1};
  return {sprites,atlas:{width:2,height:2,albedo:new Uint8Array(16),normals:new Uint8Array(16),wind:new Uint8Array(4)}};
};
describe("world-plant impostors",()=>{
  it("refreshes three-component anchors after terrain changes without corrupting adjacent plants", () => {
    const plants = instances();
    const doubled = Object.fromEntries(Object.entries(plants).map(([key, value]) => {
      if (key === "count") return [key, 2];
      const source = value as Float32Array;
      const joined = new (source.constructor as typeof Float32Array)(source.length * 2);
      joined.set(source); joined.set(source, source.length);
      return [key, joined];
    })) as unknown as PropInstances;
    doubled.sourceIndex[1] = 43;
    doubled.x[1] = 5; doubled.z[1] = 7;
    const layers = createImpostors(doubled, baked(), {
      albedo: new DataTexture(), normals: new DataTexture(), wind: null
    }, {});
    doubled.y[1] = -2;
    layers.refreshTree(43);
    expect(Array.from(layers.mesh.geometry.getAttribute("anchor").array)).toEqual([0, 0, 0, 5, -2, 7]);
  });
  it("keeps plant height/tint and removes/restores both visible and shadow cards",()=>{
    const layers=createImpostors(instances(),baked(),{albedo:new DataTexture(),normals:new DataTexture(),wind:null},{});
    expect(layers.mesh.material.fragmentShader).toContain("lightLeaf");
    expect(layers.mesh.material.fragmentShader).toContain("leafClass > 0.75");
    expect(Array.from(layers.mesh.geometry.getAttribute("frame").array)).toEqual([20,60,10,54]);
    expect(layers.mesh.geometry.getAttribute("tint").getX(0)).toBeCloseTo(.8);
    expect(layers.mesh.geometry).toBe(layers.caster.geometry);
    layers.setTreeVisible(42,false);
    expect(layers.mesh.geometry.getAttribute("frame").getX(0)).toBe(0);
    layers.setTreeVisible(42,true);
    expect(layers.mesh.geometry.getAttribute("frame").getX(0)).toBe(20);
    expect(isImpostorKind(3)).toBe(true); expect(isImpostorKind(6)).toBe(true);
    expect(isImpostorKind(4)).toBe(false);expect(isImpostorKind(255)).toBe(false);
  });
  it("excludes sources removed while sprites bake and prevents later growth resurrection", async () => {
    let resolve!: (value: BakedSprites) => void;
    let present = true;
    const layer = createDeferredImpostors(new Promise(done => { resolve = done; }),
      instances(), {}, source => source === 42 && present);
    present = false; resolve(baked()); await layer.ready;
    const frame = (layer.mesh.children[0] as Mesh).geometry.getAttribute("frame");
    expect(frame.getX(0)).toBe(0);
    layer.setTreeVisible(42, true);
    expect(frame.getX(0)).toBe(0);
    present = true; layer.setTreeVisible(42, true);
    expect(frame.getX(0)).toBe(20);
    layer.dispose();
  });
  it("ignores a late bake after renderer disposal",async()=>{
    let resolve!:(b:BakedSprites)=>void;
    const layer=createDeferredImpostors(new Promise(r=>{resolve=r;}),instances(),{});
    layer.dispose(); resolve(baked());await Promise.resolve();await Promise.resolve();
    expect(layer.isReady()).toBe(false);expect(layer.mesh.children).toHaveLength(0);
  });
  it("keeps full-mesh fallback on bake failure and preserves pre-bake removals",async()=>{
    const failed=createDeferredImpostors(Promise.reject(new Error("optional bake failed")),instances(),{});
    await Promise.resolve();await Promise.resolve();expect(failed.isReady()).toBe(false);
    const good=createDeferredImpostors(Promise.resolve(baked()),instances(),{});
    good.setTreeVisible(42,false);await good.ready;
    expect((good.mesh.children[0] as Mesh).geometry.getAttribute("frame").getX(0)).toBe(0);
    good.dispose();expect(good.mesh.children).toHaveLength(0);
  });
  it("keeps the built layer hidden until its warm-up is done, with edits made meanwhile", async () => {
    let finishWarmup = () => {};
    const warmed: number[] = [];
    const layer = createDeferredImpostors(Promise.resolve(baked()), instances(), {}, () => true, {
      warmup: (textures, layers) => {
        warmed.push(textures.length, layers.length);
        return { cancel: () => {}, done: new Promise<void>(done => { finishWarmup = done; }) };
      }
    });
    for (let tick = 0; tick < 10; tick++) await Promise.resolve();
    expect(warmed).toEqual([2, 2]);
    expect(layer.isReady()).toBe(false);
    expect(layer.mesh.children).toHaveLength(0);
    layer.setTreeVisible(42, false);
    finishWarmup();
    await layer.ready;
    expect(layer.isReady()).toBe(true);
    expect((layer.mesh.children[0] as Mesh).geometry.getAttribute("frame").getX(0)).toBe(0);
    layer.dispose();
  });
});
