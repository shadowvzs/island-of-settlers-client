import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { launchBrowser, startDevServer } from './browser';
const motion=process.argv.includes('--motion');
const output=resolve('../docs/codex-model-fix/fisher-boat-review/arms-overhand'); mkdirSync(output,{recursive:true});
const {server,url}=await startDevServer(); const browser=await launchBrowser();
try {
 const page=await browser.newPage({viewport:{width:1000,height:850}}); await page.addInitScript('window.__name = value => value;');
 await page.goto(`${url}building-showcase.html?building=0&quality=minimal&sample=1`);await page.waitForFunction(()=>Boolean((window as any).__buildingReady));
 const result=await page.evaluate(async({motion,workerModule})=>{
  const p=(window as any).__buildingPreview;p.renderer.setAnimationLoop(null);p.model().root.visible=false;
  const T=await import(/* @vite-ignore */ String('/node_modules/three/build/three.module.js'));
  const workers=await import(/* @vite-ignore */ String('/src/renderers/three/three-worker.ts'));
  const packs=await import(/* @vite-ignore */ workerModule);
  const assets=await import(/* @vite-ignore */ String('/src/render-common/workers/worker-assets.ts'));
  const poseModule=await import(/* @vite-ignore */ String('/src/renderers/three/settlement/boat-worker-pose.ts'));
  const boatModule=await import(/* @vite-ignore */ String('/src/renderers/three/settlement/three-fishing-boats.ts'));
  const surfaceModule=await import(/* @vite-ignore */ String('/tools/bench/fisher-oar-surface.ts'));const textures=workers.createWorkerTextureLoader(p.renderer);const pack=new packs.ThreeWorkerPack(`${assets.WORKER_ASSET_BASE}tripo/`,textures,false);
  const w=await pack.load('roman','roman-man-grey');const root=new T.Group();p.scene.add(root);root.add(w.root);
  const pose=poseModule.createBoatWorkerPose(w.root,w.clips);
  let boatPose:any;const boats=boatModule.createThreeFishingBoats(true,{create:()=>({update:(frame:any)=>{boatPose=frame;},dispose:()=>{},handWorld:()=>undefined})});p.scene.add(boats.group);
  boats.update([{id:1,person:0,nation:'roman',x:0,y:0,z:0,yaw:0,crewed:false,rowing:false}],0);boats.group.getObjectByName('fishing_skiff_roman')!.add(root);
  const camera=new T.OrthographicCamera(-.27,.27,.23,-.23,.01,20);const shots:any[]=[];const measurements:any[]=[];
  const previous=new Map<string,any>();let maxGripError=0,maxHandStep=0,maxWristTwist=0;for(let sample=0;sample<=240;sample++){const time=sample/80/.55;
   boats.update([{id:1,person:0,nation:'roman',x:0,y:0,z:0,yaw:0,crewed:true,rowing:true}],time);pose.update(boatPose);
   root.updateMatrixWorld(true);if(motion&&sample<240){camera.position.set(2,.5,-.05);camera.lookAt(.13,.36,-.25);p.renderer.render(p.scene,camera);shots.push({name:'frame-'+String(sample).padStart(3,'0'),png:p.renderer.domElement.toDataURL('image/png').split(',')[1]});}maxGripError=Math.max(maxGripError,pose.gripError());for(const side of ['Left','Right'])maxWristTwist=Math.max(maxWristTwist,Math.abs(w.root.userData.boatOarGrips[side].wristTwist));for(const side of ['Left','Right']){const q=w.root.getObjectByName(side+'Hand').getWorldQuaternion(new T.Quaternion());if(previous.has(side))maxHandStep=Math.max(maxHandStep,q.angleTo(previous.get(side)));previous.set(side,q);}if(sample%20!==0)continue;
   const bounds:any={};const skinContacts=surfaceModule.fisherOarSurface(w.root,boats.group.getObjectByName('fishing_skiff_roman'));let minimumSideGap=Infinity;const hull=boats.group.getObjectByName('fishing_skiff_roman')!.children.find((o:any)=>o.isMesh) as any;hull.material.side=T.DoubleSide;hull.updateWorldMatrix(true,false);const ray=new T.Raycaster(); w.root.traverse((mesh:any)=>{
    if(!mesh.isSkinnedMesh||!mesh.visible)return;mesh.skeleton.update();const ids=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
    const used=new Set<number>(mesh.geometry.index?.array??Array.from({length:ids.count},(_,i)=>i));
    for(const i of used){let joint=0,weight=0;for(let k=0;k<4;k++)if(weights.getComponent(i,k)>weight){weight=weights.getComponent(i,k);joint=ids.getComponent(i,k);}
     const name=mesh.skeleton.bones[joint]?.name;if(!/^(Left|Right)(Foot|Toe)/.test(name))continue;
     const point=mesh.getVertexPosition(i,new T.Vector3()).applyMatrix4(mesh.matrixWorld);(bounds[name]??=new T.Box3()).expandByPoint(point);ray.set(new T.Vector3(0,point.y,point.z),new T.Vector3(Math.sign(point.x),0,0));const hit=ray.intersectObject(hull,false)[0];minimumSideGap=Math.min(minimumSideGap,hit ? hit.distance-Math.abs(point.x) : -1);
    }
   });measurements.push({time,minimumSideGap,skinContacts,arms:Object.fromEntries(["Left","Right"].map(side=>[side,Object.fromEntries(["Arm","ForeArm","Hand","HandMiddle1"].map(name=>[name,w.root.getObjectByName(side+name).getWorldPosition(new T.Vector3()).toArray()]))])),bounds:Object.fromEntries(Object.entries(bounds).map(([name,b]:any)=>[name,{min:b.min.toArray(),max:b.max.toArray()}]))});
   if(sample%20===0&&sample<=80)for(const [view,pos]of [['side',[2,.48,-.15]],['front',[0,.55,2]],['quarter',[2,.7,2]]]as const){camera.position.set(...pos);camera.lookAt(.13,.36,-.25);p.renderer.render(p.scene,camera);shots.push({name:view+'-'+sample,png:p.renderer.domElement.toDataURL('image/png').split(',')[1]});}
  }
  camera.left=-.18;camera.right=.18;camera.top=.153;camera.bottom=-.153;camera.updateProjectionMatrix();camera.position.set(1,1,2);camera.lookAt(.10,.28,-.02);p.renderer.render(p.scene,camera);shots.push({name:'grip',png:p.renderer.domElement.toDataURL('image/png').split(',')[1]});camera.position.set(1,.05,2);camera.lookAt(.10,.28,-.02);const bareHull=boats.group.getObjectByName('fishing_skiff_roman').children.find((node:any)=>node.isMesh);bareHull.visible=false;p.renderer.render(p.scene,camera);shots.push({name:'grip-under',png:p.renderer.domElement.toDataURL('image/png').split(',')[1]});return{measurements,shots,maxGripError,maxHandStep,maxWristTwist,padding:w.root.userData.boatFingerPadding};
 },{motion,workerModule:`/@fs${resolve('../island-of-settlers-worker-generation/src/game-three-worker.ts')}`});
 for(const s of result.shots)writeFileSync(resolve(output,`${s.name}.png`),Buffer.from(s.png,'base64'));writeFileSync(resolve(output,'measurements.json'),JSON.stringify(result.measurements,null,2));writeFileSync(resolve(output,'grip-gate.json'),JSON.stringify({samples:241,maxGripError:result.maxGripError,maxHandStep:result.maxHandStep,maxWristTwist:result.maxWristTwist},null,2));console.log(JSON.stringify({maxGripError:result.maxGripError,maxHandStep:result.maxHandStep,padding:result.padding}));
}finally{await browser.close();await server.close();}
