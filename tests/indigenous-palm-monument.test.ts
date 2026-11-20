import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { indigenousMonumentRecipe } from "../src/render-common/buildings/indigenous-monument";
import { monumentRecipe } from "../src/render-common/buildings/monument-definition";
import { NATION_SURFACES, paintBuildingSurface }
  from "../src/renderers/three/buildings/building-surface-paint";
import { createIndigenousPalmRoofGeometry }
  from "../src/renderers/three/buildings/indigenous-palm-roof-geometry";
import { palmThatchDetail } from "../src/renderers/three/buildings/palm-thatch-detail";

it("replaces the tent with low continuous palm walls and one broad thatched roof on the unchanged monument plot",()=>{
  for(const detailed of [true,false]) {
    const recipe=indigenousMonumentRecipe(detailed),{parts,...anchors}=recipe;
    const {parts:unused,...expected}=monumentRecipe();void unused;
    expect(anchors).toEqual(expected);
    expect(parts.some(part=>part.shape==="indigenous-roof"||part.surface==="cloth")).toBe(false);
    expect(parts.filter(part=>part.shape==="indigenous-palm-roof")).toHaveLength(1);
    expect(parts.filter(part=>part.surface==="palm-trunk").length).toBeGreaterThan(75);
    for(const part of parts) {
      const bounds=getRomanPartBounds(part);
      expect(bounds.min[0]).toBeGreaterThanOrEqual(-3.70001);
      expect(bounds.max[0]).toBeLessThanOrEqual(3.70001);
      expect(bounds.min[2]).toBeGreaterThanOrEqual(-4.05001);
      expect(bounds.max[2]).toBeLessThanOrEqual(3.35001);
      if(part.surface==="palm-trunk")expect(bounds.max[1]).toBeLessThan(1.5);
      if(part.surface==="wood")expect(bounds.max[1]).toBeLessThan(5.8);
    }
    const blocked=parts.filter(part=>part.shape!=="indigenous-palm-roof").filter(part=>{
      const {max,min}=getRomanPartBounds(part);
      return max[0]>-.50&&min[0]<.50&&max[1]>.12&&min[1]<1.20&&max[2]>2.60&&min[2]<3.3;
    });
    expect(blocked).toEqual([]);
  }
});

it("keeps the layered roof opaque and within its authored box with outward normals and thick eaves",()=>{
  for(const detailed of [true,false]) {
    const geometry=createIndigenousPalmRoofGeometry(detailed);
    for(const name of ["position","normal","uv"])expect(Array.from(geometry.getAttribute(name).array)
      .every(Number.isFinite)).toBe(true);
    expect(Array.from(geometry.getAttribute("position").array).every(value=>Math.abs(value)<=.50001)).toBe(true);
    const mesh=new Mesh(geometry,new MeshBasicMaterial());mesh.updateMatrixWorld();
    expect(new Raycaster(new Vector3(.23,1,0),new Vector3(0,-1,0)).intersectObject(mesh).length).toBeGreaterThan(0);
    expect(new Raycaster(new Vector3(0,1,0),new Vector3(0,-1,0)).intersectObject(mesh).length).toBeGreaterThan(0);
    for(let ix=-8;ix<=8;ix++)for(let iz=-8;iz<=8;iz++) {
      const x=ix*.055,z=iz*.055;
      if(Math.hypot(x,z)>.46)continue;
      expect(new Raycaster(new Vector3(x,1,z),new Vector3(0,-1,0)).intersectObject(mesh).length,
        `${detailed}/${x}/${z}/opaque`).toBeGreaterThan(0);
    }
    mesh.material.side=DoubleSide;
    const edge=geometry.getAttribute("position");
    const edgeYs=Array.from({length:edge.count},(_,i)=>i).filter(i=>Math.hypot(edge.getX(i),edge.getZ(i))>.46)
      .map(i=>edge.getY(i));
    expect(Math.max(...edgeYs)-Math.min(...edgeYs)).toBeGreaterThan(.02);
    geometry.dispose();mesh.material.dispose();
  }
});

it("has raised separate blades across the roof height rather than only a textured smooth cone",()=>{
  for(const detailed of [true,false]) {
    const geometry=createIndigenousPalmRoofGeometry(detailed),position=geometry.getAttribute("position");
    const raisedBands=new Set<number>();
    let raised=0;
    for(let index=0;index<position.count;index++) {
      const y=position.getY(index),t=(y+.475)/.975;
      if(t<.08||t>.9)continue;
      const smoothRadius=.484*Math.pow(1-t,.86)+.005;
      if(Math.hypot(position.getX(index),position.getZ(index))-smoothRadius>.007) {
        raised++;raisedBands.add(Math.floor(t*5));
      }
    }
    expect(raised).toBeGreaterThan(80);
    expect(raisedBands.size).toBe(5);
    geometry.dispose();
  }
});

it("finishes the eave with varied slender closed fibres below an inset opaque core",()=>{
  for(const detailed of [true,false]) {
    const geometry=createIndigenousPalmRoofGeometry(detailed),p=geometry.getAttribute("position");
    const tips:number[]=[],angles=new Set<number>();
    for(let vertex=0;vertex<p.count;vertex++) if(p.getY(vertex)<-.452) {
      tips.push(p.getY(vertex));
      const angle=(Math.atan2(p.getX(vertex),p.getZ(vertex))+Math.PI*2)%(Math.PI*2);
      angles.add(Math.floor(angle/(Math.PI*2)*16));
    }
    expect(angles.size).toBe(16);
    expect(Math.min(...tips)).toBeLessThan(-.485);
    expect(Math.max(...tips)-Math.min(...tips)).toBeGreaterThan(.025);
    const index=geometry.getIndex()!;
    for(let at=0;at<index.count;at+=3) {
      const vertices=[index.getX(at),index.getX(at+1),index.getX(at+2)];
      if(Math.min(...vertices.map(vertex=>p.getY(vertex)))>=-.452)continue;
      const span=Math.max(...vertices.flatMap(a=>vertices.map(b=>
        Math.hypot(p.getX(a)-p.getX(b),p.getZ(a)-p.getZ(b)))));
      expect(span,"A broad flat core face must not define the hanging fringe").toBeLessThan(.035);
    }
    geometry.dispose();
  }
});

it("winds every closed palm blade outward and keeps the core opaque behind blade-root gaps",()=>{
  for(const detailed of [true,false]) {
    const geometry=createIndigenousPalmRoofGeometry(detailed),p=geometry.getAttribute("position"),index=geometry.getIndex()!;
    const parents=Array.from({length:p.count},(_,vertex)=>vertex);
    const find=(vertex:number):number=>parents[vertex]===vertex?vertex:(parents[vertex]=find(parents[vertex]!));
    for(let at=0;at<index.count;at+=3) {
      const root=find(index.getX(at));
      parents[find(index.getX(at+1))]=root;parents[find(index.getX(at+2))]=root;
    }
    const groups=new Map<number,number[]>();
    for(let at=0;at<index.count;at+=3) {
      const root=find(index.getX(at)),group=groups.get(root)??[];
      group.push(at);groups.set(root,group);
    }
    const components=[...groups.values()].sort((a,b)=>b.length-a.length);
    for(const blade of components.slice(1)) {
      let volume=0;
      for(const at of blade) {
        const a=new Vector3().fromBufferAttribute(p,index.getX(at));
        const b=new Vector3().fromBufferAttribute(p,index.getX(at+1));
        const c=new Vector3().fromBufferAttribute(p,index.getX(at+2));
        volume+=a.dot(b.cross(c))/6;
      }
      expect(volume,"Closed leaf normals must face outward, not expose inverted root faces").toBeGreaterThan(1e-10);
    }
    const core=geometry.clone();
    core.setIndex(components[0]!.flatMap(at=>[index.getX(at),index.getX(at+1),index.getX(at+2)]));
    const material=new MeshBasicMaterial(),mesh=new Mesh(core,material);mesh.updateMatrixWorld(true);
    for(const y of [-.40,-.25,0,.25,.40])for(let sector=0;sector<16;sector++) {
      const angle=(sector+.37)/16*Math.PI*2,sin=Math.sin(angle),cos=Math.cos(angle);
      const ray=new Raycaster(new Vector3(sin*.8,y,cos*.8),new Vector3(-sin,0,-cos),0,.79);
      expect(ray.intersectObject(mesh).length,`${detailed}/${y}/${sector}: opaque front-facing core`).toBeGreaterThan(0);
    }
    geometry.dispose();core.dispose();material.dispose();
  }
});

it("uses its own opaque warm palm-bundle atlas with real relief instead of the cloth map",()=>{
  expect(NATION_SURFACES.indigenous!["palm-thatch"]!.sample).toBe(palmThatchDetail);
  const [albedo,normal,roughness]=paintBuildingSurface({nation:"indigenous",surface:"palm-thatch",resolution:128,detailed:true});
  for(let index=0;index<albedo!.length;index+=4){
    expect(albedo![index+3]).toBe(255);
    expect(albedo![index]).toBeGreaterThan(albedo![index+1]!);
    expect(albedo![index+1]).toBeGreaterThan(albedo![index+2]!);
  }
  const normalSlopes=Array.from(normal!).filter((_,index)=>index%4<2);
  expect(Math.max(...normalSlopes)-Math.min(...normalSlopes)).toBeGreaterThan(4);
  expect(new Set(roughness!).size).toBeGreaterThan(15);
});
