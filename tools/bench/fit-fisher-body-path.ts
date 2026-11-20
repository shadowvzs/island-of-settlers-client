import { readFileSync, writeFileSync } from "node:fs";
import { Matrix4, Triangle, Vector3 } from "three";
import { buildNationalShuttleHull } from "../../src/renderers/three/settlement/national-harbour-boat";
import { boatRimPoint } from "../../src/renderers/three/worker-boat-hand-contacts";
import { FISHING_SKIFF_BEAM, FISHING_SKIFF_LENGTH } from "../../src/render-common/ships/fishing-skiff-dimensions";
import { LIGHTER_BEAM, LIGHTER_LENGTH } from "../../src/render-common/ships/lighter-dimensions";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
const folder="/tmp/codex-fisher-boat/dense-probe";
const report=JSON.parse(readFileSync(`${folder}/roman-man-grey-runtime-review.json`,"utf8"));
const samples=report.captures.filter((c:any)=>/high-boat_lift-\d+$/.test(c.name));
const hull=buildNationalShuttleHull("roman",true);
hull.scale(FISHING_SKIFF_BEAM/LIGHTER_BEAM/WORKER_SCALE,.78/WORKER_SCALE,FISHING_SKIFF_LENGTH/LIGHTER_LENGTH/WORKER_SCALE);
hull.translate(0,-.3*.78/WORKER_SCALE,0);
const positions=hull.attributes.position!,index=hull.index;
const parts=[["Head",.12,.055],["Spine2",.12,0],["Spine1",.12,0],["Hips",.10,0],["LeftLeg",.065,0],["RightLeg",.065,0],["LeftUpLeg",.09,0],["RightUpLeg",.09,0]] as const;
const width=19;
const states=Array.from({length:31},(_,iy)=>Array.from({length:width},(_,iz)=>({x:-.45+iy*.025,z:-.15+iz*.025}))).flat(),frames:any[]=[];
for(const [i,sample]of samples.entries()){
 const phase=i/(samples.length-1);
 const worldMatrix=new Matrix4().fromArray(sample.hullMatrix);
 const triangles:Triangle[]=[];
 const vertex=(at:number)=>new Vector3().fromBufferAttribute(positions,index?index.getX(at):at).applyMatrix4(worldMatrix);
 for(let at=0;at<(index?.count??positions.count);at+=3)triangles.push(new Triangle(vertex(at),vertex(at+1),vertex(at+2)));
 const v=(name:string)=>new Vector3(...sample.joints[name]);
 const arms=["Left","Right"].map((side,k)=>({shoulder:v(side+"Arm"),length:v(side+"Arm").distanceTo(v(side+"ForeArm"))+v(side+"ForeArm").distanceTo(v(side+"Hand")),socket:new Vector3(...sample.hands[k]).sub(v(side+"Hand")),sign:k?-1:1}));
 const rows=states.map(({x,z})=>{
  const dz=-z*WORKER_SCALE,dx=-x*WORKER_SCALE;
  let collision=0,minGap=Infinity;
  for(const [part,radius,dy]of parts){const point=v(part);point.y+=dy;point.z+=dz;point.y+=dx;let nearest=Infinity;const closest=new Vector3();for(const t of triangles){t.closestPointToPoint(point,closest);nearest=Math.min(nearest,point.distanceToSquared(closest));}const gap=Math.sqrt(nearest)-radius;minGap=Math.min(minGap,gap);collision+=Math.max(0,.002-gap)**2;}
  const ease=(t:number)=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
  const move=ease(phase),change=ease((phase-.35)/.35);let reach=0;const bestAlong=0;
  for(const [k,arm]of arms.entries()){
   const side=k===0?1-2*change:1,along=arm.sign*.13*(1-move)-.12*move;
   const target=boatRimPoint(side,along);if(k===0)target.y-=.03*Math.sin(Math.PI*change);
   target.applyMatrix4(worldMatrix).sub(arm.socket);
   const shoulder=arm.shoulder.clone();shoulder.z+=dz;shoulder.y+=dx;
   reach+=Math.max(0,target.distanceTo(shoulder)-arm.length*.995)**2;
  }
  return{x,z,minGap,reach:Math.sqrt(reach),bestAlong,cost:collision*1000+reach*1000+.05*(z*z+x*x)};
 });
 frames.push({phase,rows});
}
const n=states.length,dp=frames.map(()=>Array(n).fill(Infinity)),previous=frames.map(()=>Array(n).fill(-1));
for(let j=0;j<n;j++)if(Math.abs(states[j]!.x)<.001&&Math.abs(states[j]!.z)<.001)dp[0]![j]=frames[0].rows[j].cost;
for(let i=1;i<frames.length;i++)for(let j=0;j<n;j++){
 if(i===frames.length-1&&(Math.abs(states[j]!.x)>.001||Math.abs(states[j]!.z)>.001))continue;
 const column=j%width,row=Math.floor(j/width);
 for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++){
  const nr=row+dr,nc=column+dc;if(nr<0||nr>=31||nc<0||nc>=width)continue;
  const k=nr*width+nc,dz=states[j]!.z-states[k]!.z,dx=states[j]!.x-states[k]!.x;
  const cost=dp[i-1]![k]+frames[i].rows[j].cost+.05*(dx*dx+dz*dz);
  if(cost<dp[i]![j]){dp[i]![j]=cost;previous[i]![j]=k;}
 }
}
let end=dp.at(-1)!.indexOf(Math.min(...dp.at(-1)!));const path:any[]=[];
for(let i=frames.length-1;i>=0;i--){path.push({phase:frames[i].phase,...frames[i].rows[end]});end=previous[i]![end]!;}
path.reverse();const result={path,failures:path.filter(p=>p.minGap<0||p.reach>.015)};
writeFileSync(`${folder}/hull-path-fit.json`,JSON.stringify({...result, firstCandidates:frames[0].rows.filter((p:any)=>Math.abs(p.z)<.015&&Math.abs(p.x)<.001)},null,2));
console.log(JSON.stringify({failures:result.failures.map(p=>({phase:p.phase,gap:p.minGap,reach:p.reach,x:p.x,z:p.z})),path:path.map(p=>[Number(p.x.toFixed(3)),Number(p.z.toFixed(3))])},null,2));
