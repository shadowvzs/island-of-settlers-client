import {readFileSync,writeFileSync} from 'node:fs';

import {TOOL_WARES,WARE_IDS} from '../../src/render-common/wares/ware-catalog';
const stackable=new Set(['logs','hardwoodLogs','planks','hardwoodPlanks','stone','marble','iron','hides','leather','grain']);
const actual=JSON.parse(readFileSync(process.argv[2] ?? "tools/assets/cart-model-bounds.json","utf8"));
const result:Record<string,unknown>={};
for(const ware of WARE_IDS){
 if(['boat','pig'].includes(ware))continue;
 const dims=[0,1,2].map(a=>Math.max(...actual.filter((r:any)=>r.ware===ware).map((r:any)=>r.raw[a])));
 const layDown=TOOL_WARES.has(ware)&&ware!=='crucible';
 const [w,h,d]=layDown?[dims[0]!,dims[2]!,dims[1]!]:dims as [number,number,number];
 let best:any;
 for(const turned of [false,true]){
 const width=turned?d:w,depth=turned?w:d;
 const scale=Math.min(.5,.42/width,.64/depth,.3/h);
 const x=width*scale,z=depth*scale,y=h*scale;
 let maxLayers=layDown?2:1;
 if(stackable.has(ware))maxLayers=4;
 for(let columns=1;columns<=6;columns++)for(let rows=1;rows<=6;rows++)for(let layers=1;layers<=maxLayers;layers++){
  if(columns*x+(columns-1)*.012>.420001||rows*z+(rows-1)*.012>.640001||layers*y+(layers-1)*.006>.300001)continue;
  const count=[6,4,3,2,1].find(n=>n<=columns*rows*layers)!;
  const cost=(columns*rows*layers-count)*100+(1-scale)*1000+(layers-1)*10+columns*x*rows*z;
  if(!best||count>best.count||count===best.count&&cost<best.cost)best={count,cost,columns,rows,layers,scale,layDown,turned,width:x,depth:z,height:y};
 }
 }
 if(!best)throw Error(ware);delete best.cost;result[ware]=best;
}
writeFileSync('src/render-common/logistics/cart-cargo-layouts.ts','/** Generated from both LODs of every original ware model. Regenerate with tools/analysis/cart-capacity-audit.ts. */\nexport const CART_CARGO_LAYOUTS = '+'{\n'+Object.entries(result).map(([ware,layout])=>'  '+JSON.stringify(ware)+': '+JSON.stringify(layout)).join(',\n')+'\n}'+' as const;\n');
console.log(Object.entries(result).map(([ware,layout]:any)=>`${ware}: ${layout.count}`).join('\n'));
