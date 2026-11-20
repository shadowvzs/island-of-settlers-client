import {describe,expect,it} from "vitest";

import {
 type DeckBox,layoutShipDeck,SHIP_DECK,SHIP_DECK_CRATE_WORLD,SHIP_DECK_HORSE_WORLD,
shipDeckBoxFits} from "../src/render-common/ships/ship-deck-layout";
import {deckPeopleSlots,deckPlacesWithHorses} from "../src/render-common/ships/ship-deck-people";
import {SAILING_SHIP_SCALE} from "../src/render-common/ships/ship-dimensions";
const civilian={width:.50,height:1.09,depth:.38};
const infantry={width:.52,height:1.23,depth:.46};
describe("merchant deck physical layouts",()=>{
 for(const body of [civilian,infantry])it(`supports measured ${body.height}-high passengers and three-level cargo without overlap`,()=>{
  for(const count of [0,4,Infinity]){
   const result=layoutShipDeck(body,count,Infinity);
   for(const [i,slot] of result.slots.entries()){
    expect(shipDeckBoxFits(slot.bounds)).toBe(true);
    if(slot.kind==="crate"){
     expect(slot.level).toBeLessThan(3);
     expect(slot.y).toBeCloseTo(SHIP_DECK.floorY+slot.level*SHIP_DECK_CRATE_WORLD.height/4);
     if(slot.level>0)expect(result.slots.some(below=>below.kind==="crate"&&below.x===slot.x&&below.z===slot.z&&below.level===slot.level-1)).toBe(true);
    }
    for(const other of result.slots.slice(i+1)){
     const a=slot.bounds,b=other.bounds;
     const intersection=Math.min(a.maxX,b.maxX)>Math.max(a.minX,b.minX)&&Math.min(a.maxY,b.maxY)>Math.max(a.minY,b.minY)+1e-5&&Math.min(a.maxZ,b.maxZ)>Math.max(a.minZ,b.minZ);
     expect(intersection).toBe(false);
    }
   }
  }
 });
 it("rejects mast, hatch, hull edge and excess canopy height",()=>{
  for(const [x,z,height] of [[0,0,.3],[0,-.15,.2],[.4,.6,.2],[.18,-.75,.6]]){
   expect(shipDeckBoxFits({minX:x!-.02,maxX:x!+.02,minZ:z!-.02,maxZ:z!+.02,minY:SHIP_DECK.floorY,maxY:SHIP_DECK.floorY+height!})).toBe(false);
  }
 });
});
describe("riders' horses on deck (owner 2026-10-15)",()=>{
 const overlaps=(a:DeckBox,b:DeckBox)=>Math.min(a.maxX,b.maxX)>Math.max(a.minX,b.minX)&&
  Math.min(a.maxZ,b.maxZ)>Math.max(a.minZ,b.minZ);
 it("stands horses on deck only while everyone aboard keeps a place",()=>{
  for(const people of [1,4,8,10,12,14,16])for(const riders of [1,2,3]){
   const {horses,people:places}=deckPlacesWithHorses(people,riders);
   expect(places).toHaveLength(deckPeopleSlots(people).length);
   expect(horses.length).toBeLessThanOrEqual(Math.min(riders,2));
   const bodies=[...horses,...places];
   for(const [i,slot] of bodies.entries()){
    expect(shipDeckBoxFits(slot.bounds)).toBe(true);
    for(const other of bodies.slice(i+1))expect(overlaps(slot.bounds,other.bounds)).toBe(false);
   }
   // Nobody is shut in the bow ahead of the horses.
   const bow=Math.min(...horses.map(horse=>horse.bounds.maxZ));
   expect(places.every(place=>place.z<=bow)).toBe(true);
  }
  expect(deckPlacesWithHorses(6,2).horses).toHaveLength(2);
  expect(deckPlacesWithHorses(10,2).horses).toHaveLength(1);
  expect(deckPlacesWithHorses(12,2).horses).toHaveLength(0);
 });
 it("lays the horses along the keel with the measured horse body",()=>{
  for(const horse of deckPlacesWithHorses(4,2).horses){
   expect((horse.bounds.maxZ-horse.bounds.minZ)*SAILING_SHIP_SCALE).toBeCloseTo(SHIP_DECK_HORSE_WORLD.depth);
   expect((horse.bounds.maxY-horse.bounds.minY)*SAILING_SHIP_SCALE).toBeCloseTo(SHIP_DECK_HORSE_WORLD.height);
  }
 });
});
