import type { BuildingRecipe, Point3 } from "./building-recipe";
import { createWindowShadowPane } from "./building-window-shadows";
import { refineBambooForesterDoorway } from "./japanese-bamboo-doorway";
import { bambooForesterBadgeY, bambooForesterLevelParts } from "./japanese-bamboo-forester-levels";
import { addBambooPole, addJapaneseBambooRoof, type ArchitecturalBambooPart, BAMBOO_FORESTER_WALL_TINT, type BambooAdd, withBambooRoofTint } from "./japanese-bamboo-roof";
import type { BuildingLevel } from "./levels/building-level";
import { classifyNationBody, type WallRun } from "./nation-kit-classify";
import { bodyCenter, onWall, wallNormal } from "./nation-kit-parts";

const WINDOW={left:.225,right:.475,bottom:.50,top:.76};

/** Cut the actual bamboo backing and every culm around the retained cottage window. */
const wallSections = (wall:WallRun) => {
  if(wall.along!==0||wall.min[2]<.6||wall.min[0]>WINDOW.left||wall.max[0]<WINDOW.right)
    return [wall];
  const section=(left:number,right:number,bottom:number,top:number):WallRun=>({
    ...wall,min:[left,bottom,wall.min[2]],max:[right,top,wall.max[2]],length:right-left,base:bottom,height:top-bottom
  });
  return [section(wall.min[0],WINDOW.left,wall.base,wall.base+wall.height),
    section(WINDOW.right,wall.max[0],wall.base,wall.base+wall.height),
    section(WINDOW.left,WINDOW.right,wall.base,WINDOW.bottom),
    section(WINDOW.left,WINDOW.right,WINDOW.top,wall.base+wall.height)];
};

const bambooWall = (add:BambooAdd,wall:WallRun,centre:Point3,detailed:boolean) => {
  const normal=wallNormal(wall,centre),diameter=detailed?.075:.155;
  const backingSize:Point3=wall.along===0?[wall.length,wall.height,.032]:[.032,wall.height,wall.length];
  add({shape:"box",surface:"japanese-bamboo",stage:1,position:onWall(wall,centre,.5,wall.base+wall.height/2),
    size:backingSize,tint:[BAMBOO_FORESTER_WALL_TINT[0]*.83,BAMBOO_FORESTER_WALL_TINT[1]*.83,BAMBOO_FORESTER_WALL_TINT[2]*.79]});
  const count=Math.max(1,Math.ceil(wall.length/diameter)),spacing=wall.length/count;
  for(let index=0;index<count;index++)add({shape:"architectural-bamboo",bambooSection:"facing",
    bambooPhase:(index*.37)%1,surface:"japanese-bamboo",stage:1,
    position:onWall(wall,centre,(index+.5)/count,wall.base+wall.height/2,.013),
    rotation:wall.along===0?[0,normal.sign<0?Math.PI:0,0]:[0,normal.sign*Math.PI/2,0],
    size:[spacing*.98,wall.height,.052],tint:index%5===0?
      [BAMBOO_FORESTER_WALL_TINT[0]*.92,BAMBOO_FORESTER_WALL_TINT[1]*.94,BAMBOO_FORESTER_WALL_TINT[2]*.91]:
      [...BAMBOO_FORESTER_WALL_TINT]});
};

/** Owner-approved bamboo Forester20 only: new shell around unchanged productive nursery and anchors. */
export const createJapaneseBambooForester = (original:BuildingRecipe,detailed:boolean,level:BuildingLevel=1) => {
  const body=classifyNationBody(original);
  // High's elevated masonry window backing is facade dressing, not another room wall.
  // Including it moves the gable in front of its sign and duplicates the window's wall layers.
  body.walls=body.walls.filter(wall=>wall.base<.1&&wall.height>.8);
  const centre=bodyCenter(body.walls);
  const parts:ArchitecturalBambooPart[]=original.parts.filter(part=>part.stock||part.workyardAssembly)
    .filter(part=>!(part.workyardAssembly&&part.surface==="roof"&&part.shape==="box"))
    .map(part=>!part.stock&&part.workyardAssembly==="resource-20"&&part.position[2]>.77?
      {...part,position:[part.position[0],part.position[1]-.09,part.position[2]]}:part);
  const add:BambooAdd=part=>{parts.push(part);};
  for(const wall of body.walls)for(const section of wallSections(wall))bambooWall(add,section,centre,detailed);
  const top=Math.max(...body.walls.map(wall=>wall.base+wall.height)),eave=top+.065,rise=.46;
  const minX=Math.min(...body.walls.map(wall=>wall.min[0])),maxX=Math.max(...body.walls.map(wall=>wall.max[0]));
  const minZ=Math.min(...body.walls.map(wall=>wall.min[2])),maxZ=Math.max(...body.walls.map(wall=>wall.max[2]));
  add({shape:"box",surface:"planks",stage:1,position:[centre[0],.012,centre[2]],
    size:[maxX-minX-.12,.028,maxZ-minZ-.12]});
  for(const x of [minX+.035,maxX-.035])for(const z of [minZ+.035,maxZ-.035]) {
    add({shape:"bevel-box",surface:"stone",stage:1,position:[x,.055,z],size:[.15,.11,.15],tint:[.75,.73,.68]});
    addBambooPole(add,[x,.09,z],[x,eave+.025,z],.095);
    for(const y of [.18,eave-.085])
      add({shape:"ring",surface:"rope",stage:2,position:[x,y,z],size:[.105,.025,.105],
        radialSegments:detailed?8:3});
  }
  for(const z of [minZ+.035,maxZ-.035]) {
    addBambooPole(add,[minX-.025,eave-.035,z],[maxX+.025,eave-.035,z],.075);
    addBambooPole(add,[centre[0],eave-.035,z],[centre[0],eave+rise-.04,z],.065);
    const count=detailed?20:12,spacing=(maxX-minX)/count;
    for(let index=0;index<count;index++) {
      const x=minX+(index+.5)*spacing,h=rise*(1-Math.abs(x-centre[0])/((maxX-minX)/2));
      add({shape:"architectural-bamboo",bambooSection:"facing",bambooPhase:index*.27,
        surface:"japanese-bamboo",stage:3,position:[x,eave+h/2-.02,z],
        rotation:[0,z<centre[2]?Math.PI:0,0],size:[spacing*.99,h+.04,.045],tint:[...BAMBOO_FORESTER_WALL_TINT]});
    }
  }
  for(const x of [minX+.035,maxX-.035])for(const y of [.19,eave-.035])
    addBambooPole(add,[x,y,minZ+.035],[x,y,maxZ-.035],.065);
  const door=original.door,width=original.doorDimensions?.width??.46,doorTop=original.doorDimensions?.height??.77;
  for(const x of [door[0]-.04,door[0]+width+.04])addBambooPole(part=>add({...part,bambooDoorJamb:true}),[x,.025,door[2]+.025],[x,doorTop+.11,door[2]+.025],.075);
  addBambooPole(add,[door[0]-.095,doorTop+.08,door[2]+.025],
    [door[0]+width+.095,doorTop+.08,door[2]+.025],.085);
  // A real lintel infill closes the wall above the preserved arched door, without covering its void.
  const above=top-doorTop;
  if(above>0)add({shape:"box",surface:"japanese-bamboo",stage:1,
    position:[door[0]+width/2,doorTop+above/2,door[2]-.015],size:[width,above,.035]});
  const frontWall=body.walls.find(wall=>wall.along===0&&wall.min[0]<=WINDOW.left&&wall.max[0]>=WINDOW.right&&wall.min[2]>.6)!;
  const wallCentre=(frontWall.min[2]+frontWall.max[2])/2;
  const wallFace=wallCentre+.013+.026,frameZ=wallCentre+.033;
  add(createWindowShadowPane({shape:"box",surface:"dark",stage:2,position:[.35,.63,wallFace+.002],size:[.25,.26,.006],
    windowShadowDecorative:true}));
  for(const x of [WINDOW.left-.025,WINDOW.right+.025])addBambooPole(add,[x,WINDOW.bottom-.035,frameZ],
    [x,WINDOW.top+.035,frameZ],.045);
  for(const y of [WINDOW.bottom-.025,WINDOW.top+.025])addBambooPole(add,[WINDOW.left-.04,y,frameZ],
    [WINDOW.right+.04,y,frameZ],.045);
  const badgeY=bambooForesterBadgeY(top,level),badgeX=door[0]+width/2;
  // Hidden timber spacers carry the plaque from the actual lintel/gable into its existing back face.
  for(const side of [-1,1])add({shape:"box",surface:"wood",stage:2,
    position:[badgeX+side*.105,badgeY,wallCentre+.0255],size:[.045,.08,.043]});
  add({shape:"bevel-box",surface:"planks",stage:3,occupationSign:true,
    position:[badgeX,badgeY,wallFace+.012],size:[.31,.20,.024]});
  add({shape:"forester-tree-sign",surface:"paint",stage:3,occupationSign:true,
    position:[badgeX,badgeY,wallFace+.025],size:[.20,.185,.001]});
  addJapaneseBambooRoof(add,[centre[0],eave,centre[2]],maxX-minX+.20,maxZ-minZ+.25,rise,detailed);
  // The productive nursery keeps every shelf/pot/sapling and its canonical contact coordinate.
  const nurseryRoof=original.parts.find(part=>part.workyardAssembly&&part.surface==="roof"&&part.shape==="box");
  if(nurseryRoof) {
    const p=nurseryRoof.position;
    const roofAdd:BambooAdd=part=>add(withBambooRoofTint(part));
    roofAdd({shape:"box",surface:"japanese-bamboo",stage:4,position:p,size:nurseryRoof.size,rotation:nurseryRoof.rotation});
    const count=detailed?16:8;
    for(let index=0;index<count;index++)roofAdd({shape:"architectural-bamboo",bambooSection:"split",bambooConcave:index%2===0,
      surface:"japanese-bamboo",stage:4,position:[p[0],p[1]+.033,p[2]-.59+index*1.18/(count-1)],
      size:[1.25/count,.265,.042],rotation:[-Math.PI/2,-Math.PI/2,-.29]});
  }
  parts.push(...bambooForesterLevelParts(door,top,level,detailed));
  return refineBambooForesterDoorway({...original,parts},detailed);
};
