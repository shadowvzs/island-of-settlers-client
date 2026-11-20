import { DMath } from "../../shared/math/deterministic-math";
import { SAILING_SHIP_SCALE } from "./ship-dimensions";

/** Authored merchant-deck coordinates before the uniform ×4 ship scale. */
export const SHIP_DECK = {
  floorY:.205, minZ:-.84,maxZ:.92,
  mast:{x:0,z:0,radius:.06},
  hatch:{minX:-.21,maxX:.21,minZ:-.33,maxZ:.03},
  stairs:{minX:-.12,maxX:.12,minZ:-.84,maxZ:-.69},
  canopy:{minX:-.245,maxX:.245,minZ:-1.03,maxZ:-.70,roofY:.62,postRadius:.02,
    posts:[[-.24,-.74],[.24,-.74],[-.24,-.98],[.24,-.98]] as readonly (readonly number[])[]}
} as const;
export const SHIP_DECK_RIGGING: readonly (readonly (readonly number[])[])[] = [
  ...[-1,1].flatMap(side=>[
    [[0,1.74,0],[side*.38,.24,-.58]],
    [[side*.67,1.67,-.04],[side*.37,.24,-.04]]
  ]),[[0,1.8,0],[0,.55,-1.18]],
  ...[-1,1].flatMap(side=>[
    [[0,1.74,0],[side*.38,.24,-.35]],
    ...Array.from({length:8},(_,index)=>{
      const f=(index+1)/9;return [[side*.38*f,1.74-1.5*f,-.35*f],[side*.38*f,1.74-1.5*f,-.58*f]];
    })
  ])
];
export const shipDeckHalfWidth=(z:number)=>Math.max(0,
  DMath.sin((z/2.2+.5)*Math.PI)**.7*.42*.9-.035);
export interface DeckBodySize {width:number;height:number;depth:number}
export interface DeckBox {minX:number;maxX:number;minY:number;maxY:number;minZ:number;maxZ:number}
export interface ShipDeckSlot {kind:"passenger"|"crate"|"horse";x:number;y:number;z:number;level:number;bounds:DeckBox}
export const SHIP_DECK_CRATE_WORLD:DeckBodySize={width:.6,height:.45,depth:.6};
/** A standing person on deck (world units). */
export const SHIP_DECK_PERSON_WORLD:DeckBodySize={width:.54,height:1.3,depth:.5};
/**
 * A rider's horse standing nose to tail along the keel (world units): the measured idle horse is
 * 1.64 long, 1.22 high and .62 wide (owner 2026-10-15: horses on deck when room allows).
 */
export const SHIP_DECK_HORSE_WORLD:DeckBodySize={width:.64,height:1.25,depth:1.68};
const gap=.02;
const rectOverlap=(a:DeckBox,b:{minX:number;maxX:number;minZ:number;maxZ:number})=>
  a.minX<b.maxX+gap&&a.maxX>b.minX-gap&&a.minZ<b.maxZ+gap&&a.maxZ>b.minZ-gap;
const circleOverlap=(a:DeckBox,x:number,z:number,r:number)=>
  DMath.hypot(Math.max(a.minX-x,0,x-a.maxX),Math.max(a.minZ-z,0,z-a.maxZ))<r+gap;
const segmentIntersectsBox=(first:readonly number[],last:readonly number[],box:DeckBox,radius:number)=>{
  let enter=0,exit=1;
  for(const [axis,min,max] of [[0,box.minX,box.maxX],[1,box.minY,box.maxY],[2,box.minZ,box.maxZ]] as const){
    const start=first[axis]!,delta=last[axis]!-start;
    if(Math.abs(delta)<1e-9){if(start<min-radius||start>max+radius)return false;continue;}
    const a=(min-radius-start)/delta,b=(max+radius-start)/delta;
    enter=Math.max(enter,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));if(enter>exit)return false;
  }
  return true;
};
export const shipDeckBoxFits=(box:DeckBox)=>{
  if(box.minZ<SHIP_DECK.minZ||box.maxZ>SHIP_DECK.maxZ||box.minY<SHIP_DECK.floorY-.00001)return false;
  const edge=Math.min(shipDeckHalfWidth(box.minZ),shipDeckHalfWidth(box.maxZ));
  if(Math.max(Math.abs(box.minX),Math.abs(box.maxX))>edge)return false;
  if(rectOverlap(box,SHIP_DECK.hatch)||rectOverlap(box,SHIP_DECK.stairs)||
    circleOverlap(box,0,0,SHIP_DECK.mast.radius))return false;
  // Mooring cleats and their coiled ropes are physical deck obstructions even near floor level.
  for(const z of [-.58,.45])for(const side of [-1,1]){
    const beam=DMath.sin((z/2.2+.5)*Math.PI)**.7*.42;
    if(circleOverlap(box,side*beam*.75,z+.06,.047)||
      rectOverlap(box,{minX:side*beam*.85-.031,maxX:side*beam*.85+.031,minZ:z-.011,maxZ:z+.011}))return false;
  }
  const canopy=SHIP_DECK.canopy;
  if(rectOverlap(box,canopy)&&box.maxY>canopy.roofY-.025)return false;
  if(canopy.posts.some(([x,z])=>circleOverlap(box,x!,z!,canopy.postRadius)))return false;
  for(const rope of SHIP_DECK_RIGGING)for(let i=1;i<rope.length;i++)
    if(segmentIntersectsBox(rope[i-1]!,rope[i]!,box,.012))return false;
  return true;
};
const packingGap=.005; // 2 cm between measured bodies/crates; keep wider margins around ship fittings.
const boxesOverlap=(a:DeckBox,b:DeckBox)=>a.minX<b.maxX+packingGap&&a.maxX>b.minX-packingGap&&
  a.minZ<b.maxZ+packingGap&&a.maxZ>b.minZ-packingGap&&a.minY<b.maxY-.00001&&a.maxY>b.minY+.00001;
const candidates=(size:DeckBodySize)=>{
  const w=size.width/SAILING_SHIP_SCALE,d=size.depth/SAILING_SHIP_SCALE,h=size.height/SAILING_SHIP_SCALE;
  const result:Array<{x:number;z:number;bounds:DeckBox}>=[];
  // A fine deterministic candidate grid allows different measured body envelopes, not fixed fantasy seats.
  for(let z=SHIP_DECK.minZ+d/2;z<=SHIP_DECK.maxZ-d/2;z+=.025)
    for(let x=-.34+w/2;x<=.34-w/2;x+=.025){
      const bounds={minX:x-w/2,maxX:x+w/2,minY:SHIP_DECK.floorY,maxY:SHIP_DECK.floorY+h,minZ:z-d/2,maxZ:z+d/2};
      if(shipDeckBoxFits(bounds))result.push({x,z,bounds});
    }
  return result;
};
let sideFirstHorseCandidates:ReturnType<typeof candidates>|undefined;
/** Horse places, side first (two stand abreast on the fore deck), then bow first. */
const horseCandidates=()=>sideFirstHorseCandidates??=candidates(SHIP_DECK_HORSE_WORLD)
  .sort((a,b)=>Math.abs(b.x)-Math.abs(a.x)||b.z-a.z);
/** Geometric boarding/storage capacity only; this never changes the simulation's 40-ware balance. */
export const layoutShipDeck=(body:DeckBodySize,passengers=Infinity,crates=Infinity,crate=SHIP_DECK_CRATE_WORLD,
  horses=0, reserveHorseHolders=false)=>{
  const slots:ShipDeckSlot[]=[];
  // Horses first: they need the long open fore deck; people and crates fill round them.
  for(const point of horses>0?horseCandidates():[]){
    if(slots.length>=horses)break;
    if(slots.some(slot=>boxesOverlap(slot.bounds,point.bounds)))continue;
    slots.push({kind:"horse",x:point.x,y:SHIP_DECK.floorY,z:point.z,level:0,bounds:point.bounds});
  }
  let people=0;
  const peopleCandidates=candidates(body);
  // Reserve each rider beside its horse's head before filling the remaining deck places.
  // Ordinary passengers stay aft of the horses so they can leave first.
  for(const horse of reserveHorseHolders?slots.filter(slot=>slot.kind==="horse"):[]){
    if(people>=passengers)break;
    const headZ=horse.bounds.maxZ;
    const nearby=peopleCandidates.filter(point=>!slots.some(slot=>boxesOverlap(slot.bounds,point.bounds)))
      .sort((a,b)=>DMath.hypot(a.x-horse.x,a.z-headZ)-DMath.hypot(b.x-horse.x,b.z-headZ))[0];
    if(!nearby)continue;
    slots.push({kind:"passenger",x:nearby.x,y:SHIP_DECK.floorY,z:nearby.z,level:0,bounds:nearby.bounds});people++;
  }
  const bow=Math.min(...slots.filter(slot=>slot.kind==="horse").map(slot=>slot.bounds.maxZ));
  for(const point of peopleCandidates){
    if(people>=passengers)break;
    if(point.z>bow||slots.some(slot=>boxesOverlap(slot.bounds,point.bounds)))continue;
    slots.push({kind:"passenger",x:point.x,y:SHIP_DECK.floorY,z:point.z,level:0,bounds:point.bounds});people++;
  }
  let placed=0;
  for(const point of candidates(crate)) {
    if(placed>=crates)break;
    if(slots.some(slot=>boxesOverlap(slot.bounds,point.bounds)))continue;
    for(let level=0;level<3&&placed<crates;level++) {
      const height=crate.height/SAILING_SHIP_SCALE;
      const bounds={...point.bounds,minY:point.bounds.minY+level*height,maxY:point.bounds.maxY+level*height};
      if(!shipDeckBoxFits(bounds)||slots.some(slot=>boxesOverlap(slot.bounds,bounds)))break;
      slots.push({kind:"crate",x:point.x,y:bounds.minY,z:point.z,level,bounds});placed++;
    }
  }
  return {slots,passengers:people,crates:placed,horses:slots.filter(slot=>slot.kind==="horse").length};
};
