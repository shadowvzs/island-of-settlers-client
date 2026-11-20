import {readFileSync} from "node:fs";
import {Matrix4,Triangle,Vector3} from "three";
import {buildNationalShuttleHull} from "../../src/renderers/three/settlement/national-harbour-boat";
import {FISHING_SKIFF_BEAM,FISHING_SKIFF_LENGTH} from "../../src/render-common/ships/fishing-skiff-dimensions";
import {LIGHTER_BEAM,LIGHTER_LENGTH} from "../../src/render-common/ships/lighter-dimensions";
import {WORKER_SCALE} from "../../src/render-common/workers/worker-dimensions";
const r=JSON.parse(readFileSync(process.argv[2] ?? "/tmp/codex-fisher-boat/dense-probe/yard/roman-man-grey-runtime-review.json","utf8"));
const rows=r.captures.filter((c:any)=>c.clearance),worst=rows.reduce((a:any,b:any)=>b.clearance.Head<a.clearance.Head?b:a);
const g=buildNationalShuttleHull("roman",true);g.scale(FISHING_SKIFF_BEAM/LIGHTER_BEAM/WORKER_SCALE,.78/WORKER_SCALE,FISHING_SKIFF_LENGTH/LIGHTER_LENGTH/WORKER_SCALE);g.translate(0,-.234/WORKER_SCALE,0);
for(const c of [rows[0],rows[52],rows[55],worst])for(const [bone,radius,offset]of [["Head",.09,.055],["LeftLeg",.065,0],["RightLeg",.065,0]]as const){
 const matrix=new Matrix4().fromArray(c.hullMatrix),p=new Vector3(...c.joints[bone]);p.y+=offset;
 let distance=Infinity,best=new Vector3();const closest=new Vector3(),tri=new Triangle(),positions=g.attributes.position!,ids=g.index;
 for(let i=0;i<(ids?.count??positions.count);i+=3){const v=(j:number,out:Vector3)=>out.fromBufferAttribute(positions,ids?ids.getX(i+j):i+j).applyMatrix4(matrix);v(0,tri.a);v(1,tri.b);v(2,tri.c);tri.closestPointToPoint(p,closest);const d=p.distanceTo(closest);if(d<distance){distance=d;best.copy(closest);}}
 console.log(JSON.stringify({name:c.name,bone,center:p.toArray(),hull:best.toArray(),gap:distance-radius,delta:p.clone().sub(best).toArray()}));
}
