import { mkdirSync, readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { launchBrowser, startDevServer } from './browser';
const rosterText=readFileSync('../island-of-settlers-worker-generation/src/tripo-roster.ts','utf8');const roster=JSON.parse(rosterText.slice(rosterText.indexOf('{'),rosterText.lastIndexOf('}')+1));const appearances=Object.entries(roster).flatMap(([nation,sexes]:any)=>Object.values(sexes).flatMap((variants:any)=>variants.map((variant:string)=>({nation,variant}))));
const output=resolve('../docs/codex-model-fix/fisher-boat-review/feet'); mkdirSync(output,{recursive:true});
const {server,url}=await startDevServer(); const browser=await launchBrowser();
try {
 const page=await browser.newPage({viewport:{width:1000,height:850}}); await page.addInitScript('window.__name = value => value;');
 await page.goto(`${url}building-showcase.html?building=0&quality=minimal&sample=1`);await page.waitForFunction(()=>Boolean((window as any).__buildingReady));
 const result=await page.evaluate(async({appearances,workerModule})=>{
  const p=(window as any).__buildingPreview;p.renderer.setAnimationLoop(null);p.model().root.visible=false;
  const T=await import(/* @vite-ignore */ String('/node_modules/three/build/three.module.js'));
  const workers=await import(/* @vite-ignore */ String('/src/renderers/three/three-worker.ts'));
  const packs=await import(/* @vite-ignore */ workerModule);
  const assets=await import(/* @vite-ignore */ String('/src/render-common/workers/worker-assets.ts'));
  const poseModule=await import(/* @vite-ignore */ String('/src/renderers/three/settlement/boat-worker-pose.ts'));
  const boatModule=await import(/* @vite-ignore */ String('/src/renderers/three/settlement/three-fishing-boats.ts'));
  const paddingModule=await import(/* @vite-ignore */ String('/src/renderers/three/settlement/boat-hand-surface.ts'));const skinModule=await import(/* @vite-ignore */ String('/tools/bench/fisher-oar-surface.ts'));const textures=workers.createWorkerTextureLoader(p.renderer);const pack=new packs.ThreeWorkerPack(`${assets.WORKER_ASSET_BASE}tripo/`,textures,false);
  const results:any[]=[];for(const {nation,variant}of appearances){const w=await pack.load(nation,variant);const root=new T.Group();p.scene.add(root);root.add(w.root);
  const pose=poseModule.createBoatWorkerPose(w.root,w.clips);
  let boatPose:any;const boats=boatModule.createThreeFishingBoats(true,{create:()=>({update:(frame:any)=>{boatPose=frame;},dispose:()=>{},handWorld:()=>undefined})});p.scene.add(boats.group);
  boats.update([{id:1,person:0,nation,x:0,y:0,z:0,yaw:0,crewed:false,rowing:false}],0);boats.group.getObjectByName('fishing_skiff_'+nation)!.add(root);
  const camera=new T.OrthographicCamera(-.9,.9,.765,-.765,.01,20);const shots:any[]=[];const measurements:any[]=[];
  const previous=new Map<string,any>();let maxGripError=0,maxHandStep=0,maxElbowStep=0,maxWristBend=0,maxWristTwist=0,minimumPalmDownDot=1;const skinSamples:any[]=[];for(let sample=0;sample<=240;sample++){const time=sample/80/.55;
   boats.update([{id:1,person:0,nation,x:0,y:0,z:0,yaw:0,crewed:true,rowing:true}],time);pose.update(boatPose);
   root.updateMatrixWorld(true);maxGripError=Math.max(maxGripError,pose.gripError());for(const side of ['Left','Right']){const q=w.root.getObjectByName(side+'Hand').getWorldQuaternion(new T.Quaternion());if(previous.has(side))maxHandStep=Math.max(maxHandStep,q.angleTo(previous.get(side)));previous.set(side,q);const hand=w.root.getObjectByName(side+'Hand').getWorldPosition(new T.Vector3()),elbow=w.root.getObjectByName(side+'ForeArm').getWorldPosition(new T.Vector3()),finger=w.root.getObjectByName(side+'HandMiddle1').getWorldPosition(new T.Vector3());maxWristBend=Math.max(maxWristBend,hand.clone().sub(elbow).angleTo(finger.sub(hand)));if(previous.has(side+'elbow'))maxElbowStep=Math.max(maxElbowStep,elbow.distanceTo(previous.get(side+'elbow')));previous.set(side+'elbow',elbow);}for(const side of ['Left','Right'])maxWristTwist=Math.max(maxWristTwist,Math.abs(w.root.userData.boatOarGrips[side].wristTwist));for(const side of ['Left','Right'])minimumPalmDownDot=Math.min(minimumPalmDownDot,-w.root.userData.boatOarGrips[side].palmNormal[1]);if(sample%20===0)skinSamples.push({time,surface:skinModule.fisherOarSurface(w.root,boats.group.getObjectByName('fishing_skiff_'+nation))});if(sample%20!==0||variant!=='roman-man-grey')continue;
   const bounds:any={};let minimumSideGap=Infinity;const hull=boats.group.getObjectByName('fishing_skiff_'+nation)!.children.find((o:any)=>o.isMesh) as any;hull.material.side=T.DoubleSide;hull.updateWorldMatrix(true,false);const ray=new T.Raycaster(); w.root.traverse((mesh:any)=>{
    if(!mesh.isSkinnedMesh||!mesh.visible)return;mesh.skeleton.update();const ids=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
    const used=new Set<number>(mesh.geometry.index?.array??Array.from({length:ids.count},(_,i)=>i));
    for(const i of used){let joint=0,weight=0;for(let k=0;k<4;k++)if(weights.getComponent(i,k)>weight){weight=weights.getComponent(i,k);joint=ids.getComponent(i,k);}
     const name=mesh.skeleton.bones[joint]?.name;if(!/^(Left|Right)(Foot|Toe)/.test(name))continue;
     const point=mesh.getVertexPosition(i,new T.Vector3()).applyMatrix4(mesh.matrixWorld);(bounds[name]??=new T.Box3()).expandByPoint(point);ray.set(new T.Vector3(0,point.y,point.z),new T.Vector3(Math.sign(point.x),0,0));const hit=ray.intersectObject(hull,false)[0];minimumSideGap=Math.min(minimumSideGap,hit ? hit.distance-Math.abs(point.x) : -1);
    }
   });measurements.push({time,minimumSideGap,bounds:Object.fromEntries(Object.entries(bounds).map(([name,b]:any)=>[name,{min:b.min.toArray(),max:b.max.toArray()}]))});
   if(sample===20)for(const [name,pos]of [['side',[3,1,0]],['bow',[0,1,3]],['quarter',[2,1.8,3]]]as const){camera.position.set(...pos);camera.lookAt(0,.25,0);p.renderer.render(p.scene,camera);shots.push({name,png:p.renderer.domElement.toDataURL('image/png').split(',')[1]});}
  }
  results.push({nation,variant,samples:241,maxGripError,maxHandStep,maxElbowStep,maxWristBend,maxWristTwist,minimumPalmDownDot,skinSamples,padding:w.root.userData.boatFingerPadding,posedPadding:paddingModule.measureBoatFingerPadding(w.root)});boats.dispose();w.dispose();root.removeFromParent();}return results;
 },{workerModule:`/@fs${resolve('../island-of-settlers-worker-generation/src/game-three-worker.ts')}`,appearances});
 writeFileSync(resolve(output,'roster-grip-gate.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(result.some((entry:any)=>entry.maxGripError>.002||entry.maxHandStep>.4||entry.maxElbowStep>.08||entry.maxWristBend>Math.PI/2||entry.minimumPalmDownDot<.95||entry.skinSamples.some((sample:any)=>Object.keys(sample.surface).length!==10||Object.values(sample.surface).some((digit:any)=>digit.penetratingVertices>0||digit.minimumGap>.005))))throw new Error('Grip or motion gate failed; see roster-grip-gate.json');
}finally{await browser.close();await server.close();}
