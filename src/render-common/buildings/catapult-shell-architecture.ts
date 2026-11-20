import type { WorkerNation } from "../workers/worker-nation";
import type { BuildingPart, Point3 } from "./building-recipe";
import { createWindowShadowPane } from "./building-window-shadows";
import { addChineseCatapultFan } from "./catapult-chinese-fan";
import { CHINESE_CATAPULT_ROUND_WINDOW } from "./catapult-chinese-round-window";
import { catapultRoofHeight } from "./catapult-dimensions";
import { type CatapultShellNation,catapultShellOuterRadius } from "./catapult-national-shell-profile";
import { catapultNationalWallSurface } from "./catapult-national-wall-finish";
import { addPersianCatapultRosette } from "./catapult-persian-rosette";
import { addVikingCatapultEntryAxes } from "./catapult-viking-entry-axes";
import { catapultWindowContour, type CatapultWindowStyle } from "./catapult-window-profiles";
import { runBetween } from "./nation-kit-parts";
import { shieldAssembly } from "./nubian-decor-props";

/** Fitted accessories for the new shells only; Maya retains its accepted architecture and entry hood. */
export const createCatapultShellArchitecture=(nation:CatapultShellNation,detailed:boolean):BuildingPart[]=>{
  const parts:BuildingPart[]=[];
  const add=(part:Omit<BuildingPart,"stage">)=>parts.push({architecture:true,stage:2,...part});
  const point=(angle:number,y:number,outward=0):Point3=>{
    const radius=catapultShellOuterRadius(nation,angle,y)+outward;
    return [Math.sin(angle)*radius,y,Math.cos(angle)*radius];
  };
  const hood=(angle:number,y:number,width:number,depth:number)=>{
    const base=point(angle,y,.045),roofHeight=nation==="persian"?.10:.13;
    const surface:BuildingPart["surface"]=nation==="indigenous"?"roof-thatch":"roof";
    let form:BuildingPart["occupationRoof"]="gable";
    if(nation==="japanese"||nation==="chinese")form="hip";
    if(nation==="persian"||nation==="nubian")form="barrel";
    const roof:BuildingPart={position:[base[0],y+roofHeight/2,base[2]],rotation:[0,angle,0],
      shape:"occupation-roof",occupationRoof:form,size:[width,roofHeight,depth],surface,stage:3,
      architecture:true,compactGeometry:true,roofCompactGeometry:true};
    if(nation==="indigenous") {
      roof.shape="lean-thatch-roof";roof.plantRoofStyle="reed";
      roof.rotation=[0,angle-Math.PI/2,0];roof.size=[depth,roofHeight,width];
    }
    if(nation==="japanese"||nation==="chinese") {
      roof.roofSweep=.10;roof.roofCurve=.08;roof.roofTiles=detailed?"pan-cover":undefined;roof.roofTileSpacing=2;
    }
    parts.push(roof);
    // Both brackets embed into the actual curved/polygonal wall and carry a joined front bearing.
    const side:Point3=[Math.cos(angle),0,-Math.sin(angle)],normal:Point3=[Math.sin(angle),0,Math.cos(angle)];
    const p=(across:number,away:number,height:number):Point3=>[
      base[0]+side[0]*across+normal[0]*away,height,base[2]+side[2]*across+normal[2]*away];
    for(const sign of [-1,1]) {
      runBetween(add,p(sign*width*.34,-depth*.48,y-.015),p(sign*width*.34,depth*.42,y-.015),
        [.035,.035],{surface:"wood",roofSupport:true});
      runBetween(add,p(sign*width*.34,-depth*.40,y-.13),p(sign*width*.34,depth*.28,y-.035),
        [.026,.026],{surface:"wood",roofSupport:true});
    }
    runBetween(add,p(-width*.40,depth*.37,y-.018),p(width*.40,depth*.37,y-.018),
      [.035,.035],{surface:"wood",roofSupport:true});
  };
  // The unchanged square deck needs real bearing joists where a rounded outer wall leaves corners.
  // Rear-left is deliberately absent: the preserved hatch pocket carries that corner and must stay open.
  const bearingY=catapultRoofHeight(1.69)-.13;
  for(const z of [-.10,.64])add({position:[0,bearingY,z],size:[1.64,.10,.07],surface:"wood",shape:"box"});
  add({position:[.31,bearingY,-.64],size:[1.02,.10,.07],surface:"wood",shape:"box"});
  add({position:[.64,bearingY,0],size:[.07,.10,1.64],surface:"wood",shape:"box"});
  if(nation!=="indigenous")hood(0,1.005,.84,.34);
  for(const sign of [-1,1]) {
    const angle=Math.atan2(sign*.8,-.08),centre=point(angle,1.945,-.055);
    let style:CatapultWindowStyle|undefined;
    if(nation==="persian")style="persian-pointed";
    if(nation==="roman")style="roman-arch";
    if(nation==="japanese")style="japanese-shoji";
    const pane=createWindowShadowPane({position:centre,rotation:[0,angle,0],size:[.26,.32,.004],
      shape:"box",surface:"dark",stage:2,windowShadowDecorative:true,catapultWindowStyle:style});
    if(style)pane.windowShadowContour=catapultWindowContour(style,detailed)
      .map(([x,y])=>[x/.8125,y/.8533334] as const);
    add(pane);
    const front=point(angle,1.945,.006),side:Point3=[Math.cos(angle),0,-Math.sin(angle)];
    if(style){
      add({position:front,rotation:[0,angle,0],size:[.32,.375,.032],surface:"wood",
        shape:"catapult-window-frame",catapultWindowStyle:style});
      if(style!=="japanese-shoji")add({position:point(angle,1.945,-.10),rotation:[0,angle,0],
        size:[.32,.375,.22],surface:catapultNationalWallSurface(nation),
        shape:"catapult-window-reveal",catapultWindowStyle:style});
      if(style==="persian-pointed")add({position:point(angle,1.945,-.018),rotation:[0,angle,0],
        size:[.32,.375,.001],surface:"paint",shape:"catapult-window-glass",catapultWindowStyle:style});
    }else for(const edge of [-1,1]) {
      add({position:[front[0]+side[0]*edge*.147,front[1],front[2]+side[2]*edge*.147],
        rotation:[0,angle,0],size:[.034,.375,.032],surface:"wood",shape:"box"});
      add({position:[front[0],front[1]+edge*.175,front[2]],rotation:[0,angle,0],
        size:[.32,.035,.032],surface:"wood",shape:"box"});
    }
    const enlarged=nation!=="indigenous";
    hood(angle,2.17,enlarged?.50:.45,enlarged?.27:.23);
    // Decorative windows have no soldier slot; two seated slats leave the actual aperture open.
    if(nation!=="indigenous"&&!style)for(const offset of [-.055,.055])
      add({position:[front[0]+side[0]*offset,front[1],front[2]+side[2]*offset],
        rotation:[0,angle,0],size:[.015,.30,.022],surface:"wood",shape:"box"});
  }
  if(nation==="nubian") {
    const back=point(Math.PI,1.48);
    const assembly=shieldAssembly({along:0,detailed,variant:1,y:1.48,
      face:{along:0,axis:2,sign:-1,plane:back[2],from:-.36,to:.36,base:0,top:2.3,side:"back",yaw:Math.PI}},false);
    for(const part of assembly.parts)parts.push({...part,architecture:true});
  }
  if(nation==="chinese"){
    const {centreY,radius}=CHINESE_CATAPULT_ROUND_WINDOW;
    const diameter=radius*2/.8533334;
    add({position:point(Math.PI,centreY,.008),rotation:[0,Math.PI,0],size:[diameter,diameter,.038],
      shape:"catapult-window-frame",catapultWindowStyle:"chinese-round",surface:"wood",tint:[1.45,1.25,1]});
    const pane=createWindowShadowPane({position:point(Math.PI,centreY,-.055),rotation:[0,Math.PI,0],
      size:[radius*2,radius*2,.001],shape:"box",surface:"dark",stage:2,
      windowShadowDecorative:true,catapultWindowStyle:"chinese-round"});
    pane.windowShadowContour=catapultWindowContour("chinese-round",detailed)
      .map(([x,y])=>[x/.8533334,y/.8533334] as const);
    add(pane);
  }
  addWallOrnament(add,nation,point(0,nation==="persian"?1.434:1.56,.012),detailed);
  return parts;
};

type Add=(part:Omit<BuildingPart,"stage">)=>unknown;
const addWallOrnament=(add:Add,nation:Exclude<WorkerNation,"maya">,centre:Point3,detailed:boolean)=>{
  if(nation==="viking") {
    addVikingCatapultEntryAxes(add,centre,detailed);
    return;
  }
  if(nation==="chinese") {
    addChineseCatapultFan(add,centre,detailed);
    return;
  }
  if(nation==="persian") {
    addPersianCatapultRosette(add,centre,detailed);
    return;
  }
  const relief=(x:number,y:number,size:Point3,surface:BuildingPart["surface"],tint?:Point3,
    rotation?:Point3,shape:BuildingPart["shape"]="box")=>add({position:[centre[0]+x,centre[1]+y,centre[2]],
      size,surface,tint,rotation,shape,radialSegments:detailed?12:6});
  if(nation==="japanese") {
    relief(0,0,[.27,.31,.025],"wood");
    for(const x of [-.065,0,.065])relief(x,0,[.022,.22,.036],"japanese-bamboo",[.67,.57,.45],undefined,"cylinder");
    return;
  }
  if(nation==="indigenous")return;
  if(nation==="nubian") {
    relief(0,0,[.31,.30,.018],"nubian-textile");
    for(const y of [-.16,.16])relief(0,y,[.35,.024,.027],"wood");
    return;
  }
  const roman=nation==="roman";
  relief(0,0,[.30,.026,.30],"wood",undefined,
    [Math.PI/2,0,0],"cylinder");
    relief(0,0,[.07,.035,.07],"iron",roman?[1.5,1.05,.58]:undefined,[Math.PI/2,0,0],"cylinder");

};
