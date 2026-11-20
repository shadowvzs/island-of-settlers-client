import {expect,it} from 'vitest';

import {colonyExpiryAssets,creditExpiredColony} from '../src/shared/settlement/colony-expiry-assets';
import type {GameSaveV1} from '../src/shared/settlement/game-save';
import {createRoadNetwork} from '../src/shared/settlement/road-network';
import {createSettlementSimulation} from '../src/shared/settlement/settlement-simulation';
import {BUILD,type WorldData} from '../src/shared/world/world-data';
it('collects equipped tools, ground stock, prepaid carts and ships once without refunding spent construction',()=>{
 const save={settlement:{settlers:5,buildings:[
 {construction:1,typeId:39,inventory:{stone:12},input:{fish:1},output:{logs:6},handcarts:1},
 {construction:1,typeId:12,inventory:{coal:1},input:{fish:2},output:{ironOre:3},constructionConsumed:{planks:99}},
 {militaryFaction:1,inventory:{coins:999}}],
 actors:[{uid:1,job:'Carrier',phase:'deliver',ware:'logs'},
 {uid:2,job:'Miner',phase:'work',tool:'pickaxe',consumed:{fish:1}},
 {uid:3,job:'Farmer',phase:'inputReturn',ware:'grain',consumed:{grain:1}},
 {uid:4,job:'Woodcutter',phase:'deposit',ware:'logs',consumed:{fish:10}},
 {uid:5,job:'Carrier',phase:'retired',ware:'bread'},
 {uid:7,job:'Carrier',phase:'deliver',ware:'iron'},
 {uid:8,job:'Mount',phase:'horseMounted'},
 {uid:9,job:'Carrier',phase:'cartToDestination',handcart:{cargo:2,trip:{ware:'goldOre',prepaid:1}}},
 {uid:10,job:'Soldier',phase:'garrison',tool:'bow'},
 {uid:11,job:'Soldier',phase:'militaryField',tool:'axe'}],
 military:{soldiers:[{actor:10,rank:1,combat:{type:'archer',faction:0,hp:67.5}},
 {actor:11,rank:0,combat:{type:'heavy',faction:1,hp:100}}]},
 naval:{fleet:{ships:[{orderId:2,cargo:{wine:4},troops:[{type:'shield',rank:0,hp:100}]}],
 orders:[{id:2,cargo:{wine:4}},{id:3,cargo:{marble:2}}]}}}} as unknown as GameSaveV1;
 const before=JSON.stringify(save),assets=colonyExpiryAssets(save);
 expect(assets).not.toHaveProperty('settlers');
 expect(assets.cargo).toEqual({stone:12,fish:4,logs:8,handcart:2,coal:1,ironOre:3,pickaxe:1,grain:1,iron:1,goldOre:3,marble:2,wine:4});
 expect(assets.troops).toEqual([{type:'archer',rank:1,hp:67.5},{type:'shield',rank:0,hp:100}]);
 expect(JSON.stringify(save)).toBe(before);
});
it('credits every asset into saved home storage and preserves valid cavalry, population and source state',()=>{
 const size=40,world={seed:2,cellsX:size,cellsZ:size,seaLevel:-1,start:{x:5.5,z:5.5},
 heights:new Float32Array(41**2),blocking:new Uint8Array(size**2),walkCost:new Uint8Array(size**2).fill(10),
 buildClass:new Uint8Array(size**2).fill(BUILD.large),props:{count:0,types:new Uint8Array(),x:new Float32Array(),z:new Float32Array()}} as unknown as WorldData;
 const sim=createSettlementSimulation({world,roads:createRoadNetwork(world)});
 const original=sim.saveState(),home={settlement:original} as GameSaveV1;
 const result=creditExpiredColony(home,{cargo:{marble:17,bow:2},troops:[{type:'cavalry',rank:0,hp:105}]});
 expect(original.actors).toHaveLength(0);
 // The expired colony's people stay behind (owner 2026-10-20).
 expect(result.settlement.settlers).toBe(original.settlers);
 expect(sim.loadState(result.settlement)).toEqual({ok:true});
 expect(sim.headquarters.inventory.marble).toBe(17);
 expect(sim.headquarters.inventory.bow).toBe((original.storagePools.pools.find(pool=>pool.id===original.buildings[0]!.storagePoolId)!.available.bow??0)+2);
 expect(sim.militarySoldiers().filter(s=>s.combat?.type==='cavalry')).toHaveLength(1);
 expect(sim.frames().find(a=>a.job==='Soldier')?.phase).toBe('militaryReserve');
});
