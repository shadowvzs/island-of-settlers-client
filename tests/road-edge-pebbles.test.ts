import { readFileSync } from "node:fs";

import { type BufferGeometry,Mesh } from "three";
import { describe, expect, it } from "vitest";

import {computeEnvironment} from "../src/render-common/environment";
import { createRoadGeometry } from "../src/renderers/three/settlement/road-geometry";
import { createThreeRoads } from "../src/renderers/three/settlement/three-roads";
import { createBuildingRoadApproaches } from "../src/shared/settlement/building-road-approaches";
import { createRoadBend } from "../src/shared/settlement/road-curves";
import type { RoadPoint,RoadSegment } from "../src/shared/settlement/road-types";
const line=(z:number,tier:"dirt"|"stone"="dirt"):RoadSegment=>({start:{x:0,z},end:{x:6,z},tier});
const build=(segments:RoadSegment[],detailed=true,tier:"dirt"|"stone"="dirt")=>{
  let pebbles:BufferGeometry|undefined;
  const surface=createRoadGeometry(segments,tier,detailed,()=>0,false,geometry=>{pebbles=geometry;});
  return {surface,pebbles:pebbles!,dispose:()=>{surface.dispose();pebbles?.dispose();}};
};
type Stone={along:number;row:number;x:number;z:number};
const SPACING=.225;
const MINIMAL_SPACING=.425;
const spacingFor=(detailed:boolean)=>detailed?SPACING:MINIMAL_SPACING;
const bend=():RoadSegment[]=>[
  {start:{x:0,z:0},end:{x:4,z:0},tier:"dirt"},
  {start:{x:4,z:0},end:{x:4,z:4},tier:"dirt"}
];
const minimumPairDistance=(stones:Stone[])=>{
  let minimum=Infinity;
  for(let first=0;first<stones.length;first++)for(let second=first+1;second<stones.length;second++)
    minimum=Math.min(minimum,Math.hypot(stones[first]!.x-stones[second]!.x,stones[first]!.z-stones[second]!.z));
  return minimum;
};

describe("cached exposed dirt road pebbles",()=>{
  it.each([true,false])("adds sparse small stones on both free edges and exposed dead-end caps, detail=%s", detailed=>{
    const model=build([line(0)],detailed);
    const centres=model.pebbles.userData.pebbles as {x:number;z:number;side:number}[];
    expect(centres.length).toBeGreaterThan(4);
    expect(new Set(centres.map(point=>point.side))).toEqual(new Set([-1,1]));
    for(const point of centres){
      // Stale since 041bde88c: owner Nov 3 widened dirt roads 0.8 -> 0.9 (half width 0.45); doors stay 0.34.
      expect(point.x).toBeGreaterThan(-.46); expect(point.x).toBeLessThan(6.46);
      if(point.x>=.12&&point.x<=5.88){expect(Math.abs(point.z)).toBeGreaterThan(.4);expect(Math.abs(point.z)).toBeLessThan(.44);}
    }
    expect(centres.some(point=>point.x<0)).toBe(true);
    expect(centres.some(point=>point.x>6)).toBe(true);
    expect(model.pebbles.index!.count/3).toBe(centres.length*8);
    const positions=model.pebbles.getAttribute("position");
    for(let i=0;i<positions.count;i++){expect(positions.getY(i)).toBeGreaterThan(0);expect(positions.getY(i)).toBeLessThan(.07);}
    model.dispose();
  });
  it.each(["dirt","stone"] as const)("suppresses covered sides against adjacent %s roads while retaining outer edges", tier=>{
    const model=build([line(0),line(.74,tier)]);
    const centres=model.pebbles.userData.pebbles as {x:number;z:number}[];
    expect(centres.some(point=>point.z<0)).toBe(true);
    // Beyond the endpoints the exposed semicircular caps are legitimate outer edges.
    expect(centres.some(point=>point.x>=0&&point.x<=6&&point.z>0&&point.z<.74)).toBe(false);
    if(tier==="dirt")expect(centres.some(point=>point.z>.74)).toBe(true);
    model.dispose();
  });
  it("leaves T-junction crossings and narrowed doorway thresholds clear",()=>{
    const segments:RoadSegment[]=[line(0),{start:{x:3,z:0},end:{x:3,z:3},tier:"stone"},
      {start:{x:8,z:0},end:{x:10,z:0},tier:"dirt",doorway:true}];
    const model=build(segments);
    for(const point of model.pebbles.userData.pebbles as {x:number;z:number}[]){
      expect(point.x>2.6&&point.x<3.4&&point.z>0).toBe(false);
      if(point.x>8)expect(point.x).toBeLessThan(9.3);
    }
    model.dispose();
  });
  it("uses less geometry in Minimal and preserves deterministic placement and road surface vertices",()=>{
    const high=build([line(0)]),minimal=build([line(0)],false),again=build([line(0)]);
    expect(minimal.pebbles.index!.count).toBeLessThan(high.pebbles.index!.count);
    expect(again.pebbles.userData.pebbles).toEqual(high.pebbles.userData.pebbles);
    const plain=createRoadGeometry([line(0)],"dirt",true,()=>0);
    expect(Array.from(plain.getAttribute("position").array)).toEqual(Array.from(high.surface.getAttribute("position").array));
    plain.dispose();high.dispose();minimal.dispose();again.dispose();
  });
  it("shares one extra immutable dirt batch, disposes it on graph replacement and omits stone-only/preview pebbles",()=>{
    const world={cellsX:8,cellsZ:8,heights:new Float32Array(81),blocking:new Uint8Array(64)};
    const roads=createThreeRoads(world,"high",()=>0);roads.update([line(0)]);
    const mesh=roads.root.getObjectByName("dirt_road_edge_pebbles") as Mesh;
    expect(mesh).toBeInstanceOf(Mesh);
    const positions=mesh.geometry.getAttribute("position");
    const original=Array.from(positions.array);
    for(let frame=0;frame<100;frame++)roads.updateEnvironment(computeEnvironment(
      {azimuthX:-.94,azimuthZ:-.34,elevation:.97},frame*.24,0));
    expect(mesh.geometry.getAttribute("position")).toBe(positions);
    expect(Array.from(positions.array)).toEqual(original);
    let disposed=false;mesh.geometry.addEventListener("dispose",()=>{disposed=true;});
    roads.update([line(0,"stone")]);expect(disposed).toBe(true);
    expect(roads.root.getObjectByName("dirt_road_edge_pebbles")).toBeUndefined();
    const blocks = roads.root.getObjectByName("stone_road_edge_blocks") as Mesh;
    expect(blocks).toBeInstanceOf(Mesh);
    const centres = blocks.geometry.userData.pebbles as {x:number;z:number}[];
    expect(centres.some(point=>point.x<0)).toBe(true);
    expect(centres.some(point=>point.z>0)).toBe(true);
    expect(blocks.geometry.index!.count/3).toBe(centres.length*20);
    const posts=blocks.geometry.getAttribute("position");
    expect(Math.max(...Array.from({length:posts.count},(_,index)=>posts.getY(index)))).toBeGreaterThan(.09);
    let collected=false;const preview=createRoadGeometry([{...line(0),preview:true}],"dirt",true,()=>0,true,()=>{collected=true;});
    expect(collected).toBe(false);preview.dispose();roads.dispose();
  });
  it.each([true,false])("keeps today's straight-road stone positions, detail=%s",detailed=>{
    const fixture=JSON.parse(readFileSync(new URL("./fixtures/road-edge-pebbles-straight.json",
      import.meta.url),"utf8")) as {detailed:[number,number][];minimal:[number,number][]};
    const model=build([line(0)],detailed);
    const sort=(positions:[number,number][])=>positions.slice()
      .sort((first,second)=>first[0]-second[0]||first[1]-second[1]);
    const actual=sort((model.pebbles.userData.pebbles as {x:number;z:number}[])
      .map(stone=>[stone.x,stone.z] as [number,number]));
    const expected=sort(detailed?fixture.detailed:fixture.minimal);
    expect(actual.length).toBe(expected.length);
    expected.forEach((position,index)=>{
      expect(actual[index]![0]).toBeCloseTo(position[0],9);
      expect(actual[index]![1]).toBeCloseTo(position[1],9);
    });
    model.dispose();
  });
  it("keeps straight-road spacing on both sides of a 90 degree bend",()=>{
    const model=build(bend());
    const stones=model.pebbles.userData.pebbles as Stone[];
    // Stones within 1.5 m of the corner belong to exactly the inner and the outer bend row.
    const rows=new Map<number,Stone[]>();
    for(const stone of stones.filter(stone=>Math.hypot(stone.x-4,stone.z)<1.5)){
      const group=rows.get(stone.row)??[];
      group.push(stone);rows.set(stone.row,group);
    }
    expect(rows.size).toBe(2);
    for(const group of rows.values()){
      const ordered=[...group].sort((first,second)=>first.along-second.along);
      const gaps=ordered.slice(1).map((stone,index)=>
        Math.hypot(stone.x-ordered[index]!.x,stone.z-ordered[index]!.z));
      expect(gaps.length).toBeGreaterThan(6);
      for(const gap of gaps){
        expect(gap).toBeGreaterThanOrEqual(SPACING*.85);
        expect(gap).toBeLessThanOrEqual(SPACING*1.15);
      }
    }
    model.dispose();
  });
  const tJunction:RoadSegment[]=[
    {start:{x:0,z:0},end:{x:4,z:0},tier:"dirt"},
    {start:{x:4,z:0},end:{x:8,z:0},tier:"dirt"},
    {start:{x:4,z:0},end:{x:4,z:4},tier:"dirt"}
  ];
  it.each([
    {name:"T-junction",segments:tJunction},
    {name:"L-corner",segments:bend()}
  ])("never doubles the stone rows at a $name",({segments})=>{
    for(const detailed of [true,false]){
      const model=build(segments,detailed);
      const stones=model.pebbles.userData.pebbles as Stone[];
      expect(stones.length).toBeGreaterThan(20);
      expect(minimumPairDistance(stones)).toBeGreaterThanOrEqual(spacingFor(detailed)*.7);
      model.dispose();
    }
  });
});

/**
 * VERGE-DENSITY-FIX (2026-11-08): join regression. A real road corner is a segment join, and the
 * two edge lines must stay one continuous row per side through it. The owner's save also has
 * fitted/approach arms whose width differs from the bend width; those seams must not restart the
 * spacing either.
 */
const rowsNear = (stones: Stone[], point: RoadPoint, radius = 1.5) => {
  const rows = new Map<number, Stone[]>();
  for (const stone of stones) {
    if (Math.hypot(stone.x - point.x, stone.z - point.z) > radius) continue;
    const group = rows.get(stone.row) ?? [];
    group.push(stone);
    rows.set(stone.row, group);
  }
  return rows;
};
const expectEvenGaps = (stones: Stone[], spacing: number, minimumStones: number) => {
  const ordered = [...stones].sort((first, second) => first.along - second.along);
  expect(ordered.length).toBeGreaterThanOrEqual(minimumStones);
  for (let index = 1; index < ordered.length; index++) {
    const gap = Math.hypot(ordered[index]!.x - ordered[index - 1]!.x,
      ordered[index]!.z - ordered[index - 1]!.z);
    expect(gap).toBeGreaterThanOrEqual(spacing * .85);
    expect(gap).toBeLessThanOrEqual(spacing * 1.15);
  }
};
const cornerSegments = (tier: "dirt" | "stone", second: RoadPoint): RoadSegment[] => [
  { start: { x: 0, z: 0 }, end: { x: 4, z: 0 }, tier },
  { start: { x: 4, z: 0 }, end: second, tier }
];

describe("continuous corner edge lines", () => {
  it.each([
    { name: "90 degree", second: { x: 4, z: 4 } },
    { name: "45 degree", second: { x: 6, z: 2 } }
  ])("keeps one continuous stone row per side through a $name corner", ({ second }) => {
    for (const detailed of [true, false]) {
      const model = build(cornerSegments("stone", second), detailed, "stone");
      const stones = model.pebbles.userData.pebbles as Stone[];
      const rows = rowsNear(stones, { x: 4, z: 0 });
      expect(rows.size).toBe(2);
      for (const group of rows.values()) expectEvenGaps(group, spacingFor(detailed), 3);
      expect(minimumPairDistance(stones)).toBeGreaterThanOrEqual(spacingFor(detailed) * .7);
      model.dispose();
    }
  });
  it.each(["dirt", "stone"] as const)("keeps both sides of a T-junction %s through road continuous", tier => {
    const segments: RoadSegment[] = [
      { start: { x: 0, z: 0 }, end: { x: 4, z: 0 }, tier },
      { start: { x: 4, z: 0 }, end: { x: 8, z: 0 }, tier },
      { start: { x: 4, z: 0 }, end: { x: 4, z: 4 }, tier }
    ];
    for (const detailed of [true, false]) {
      const model = build(segments, detailed, tier);
      const stones = model.pebbles.userData.pebbles as Stone[];
      // Each side of the through road is one row that reaches both sides of the junction. Stones
      // inside the branch paving are suppressed on purpose, so only the no-bunching bound applies.
      const through = [...rowsNear(stones, { x: 4, z: 0 }, 1.4).values()].filter(group =>
        group.some(stone => stone.x < 3.9) && group.some(stone => stone.x > 4.1));
      expect(through.length).toBe(2);
      for (const group of through) {
        const ordered = [...group].sort((first, second) => first.along - second.along);
        expect(ordered.length).toBeGreaterThanOrEqual(2);
        for (let index = 1; index < ordered.length; index++) {
          const gap = Math.hypot(ordered[index]!.x - ordered[index - 1]!.x,
            ordered[index]!.z - ordered[index - 1]!.z);
          expect(gap).toBeGreaterThanOrEqual(spacingFor(detailed) * .85);
        }
      }
      model.dispose();
    }
  });
  it.each([true, false])("keeps the outer row continuous through a building-approach seam, detail=%s",
    detailed => {
      const building = {
        access: { x: 4, z: 0 }, hasDoor: false, workerApproach: { x: 4.9, z: 1.1 },
        doorThreshold: { x: 5.7, z: 2.4 }
      } as unknown as Parameters<typeof createBuildingRoadApproaches>[1][number];
      const segments = createBuildingRoadApproaches(
        [{ start: { x: 0, z: 0 }, end: { x: 4, z: 0 }, tier: "stone" }], [building]);
      const lane = segments.find(segment => segment.start.x === 4 && segment.start.z === 0)!;
      const bend = createRoadBend({ x: 0, z: 0 }, { x: 4, z: 0 }, lane.end, 1.3)!;
      const model = build(segments, detailed, "stone");
      const stones = model.pebbles.userData.pebbles as Stone[];
      const angle = bend.startAngle + bend.sweep / 2;
      const outerRadius = bend.radius + 1.3 * .5 + .065;
      const apex = { x: bend.centre.x + Math.cos(angle) * outerRadius,
        z: bend.centre.z + Math.sin(angle) * outerRadius };
      const outerRows = new Set(stones
        .filter(stone => Math.hypot(stone.x - apex.x, stone.z - apex.z) <= .25)
        .map(stone => stone.row));
      expect(outerRows.size).toBe(1);
      const row = outerRows.values().next().value!;
      expectEvenGaps(stones.filter(stone => stone.row === row &&
        Math.hypot(stone.x - 4, stone.z) <= 1.5), spacingFor(detailed), 3);
      expect(minimumPairDistance(stones)).toBeGreaterThanOrEqual(spacingFor(detailed) * .7);
      model.dispose();
    });
});
