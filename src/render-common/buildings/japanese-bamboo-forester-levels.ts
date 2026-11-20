import type { Point3 } from "./building-recipe";
import { addBambooPole, type ArchitecturalBambooPart, type BambooAdd, withBambooRoofTint } from "./japanese-bamboo-roof";
import type { BuildingLevel } from "./levels/building-level";

export const BAMBOO_FORESTER_HOOD={height:1.06,projection:.30,rise:.07,width:.65} as const;

/** The taller existing level3 body receives joined bamboo work, never a foreign white plinth. */
export const bambooForesterLevelParts=(door:Point3,top:number,level:BuildingLevel,detailed:boolean)=>{
  const parts:ArchitecturalBambooPart[]=[];
  const add:BambooAdd=part=>{parts.push({...part,bambooUpgrade:true});};
  const pole=(from:Point3,to:Point3,diameter=.045)=>addBambooPole(add,from,to,diameter);
  if(level>=2)for(const x of [door[0]-.04,door[0]+.50])add({shape:"ring",surface:"rope",stage:2,
    position:[x,.80,door[2]+.025],size:[.084,.024,.084],radialSegments:detailed?8:3});
  if(level>=3)for(const x of [-.785,.785])pole([x,top-.12,-.60],[x,top-.12,.69]);
  if(level>=4) {
    const hood=BAMBOO_FORESTER_HOOD,centreX=door[0]+.23,centreZ=door[2]+hood.projection/2+.025;
    const pitch=Math.atan2(hood.rise,hood.projection),length=Math.hypot(hood.rise,hood.projection);
    const roofAdd:BambooAdd=part=>add(withBambooRoofTint(part));
    roofAdd({shape:"box",surface:"japanese-bamboo",stage:4,
      position:[centreX,hood.height-.019,centreZ],rotation:[pitch,0,0],size:[hood.width,.025,length]});
    const gutters=detailed?6:3;
    for(let index=0;index<gutters*2-1;index++)roofAdd({shape:"architectural-bamboo",surface:"japanese-bamboo",
      bambooSection:"split",bambooConcave:index%2===0,stage:4,
      position:[centreX-hood.width/2+(index+1)*hood.width/(gutters*2),hood.height,centreZ],
      rotation:[-Math.PI/2+pitch,0,0],size:[hood.width/gutters,length,.045]});
    for(const x of [centreX-hood.width*.37,centreX+hood.width*.37]) {
      addBambooPole(roofAdd,[x,hood.height+.02,door[2]-.005],
        [x,hood.height-.05,door[2]+hood.projection+.01],.038);
      pole([x,.88,door[2]+.02],[x,hood.height-.06,door[2]+hood.projection-.03],.035);
    }
  }
  if(level>=5)for(const x of [-.785,.785])pole([x,top-.32,-.47],[x,top-.12,-.15],.04);
  return parts;
};

/** Keep the entire image clear of the actual entry canopy; upgraded signs sit on the gable infill. */
export const bambooForesterBadgeY=(top:number,level:BuildingLevel)=>level>=4?
  Math.max(top+.10,BAMBOO_FORESTER_HOOD.height+BAMBOO_FORESTER_HOOD.rise/2+.14):1.02;
