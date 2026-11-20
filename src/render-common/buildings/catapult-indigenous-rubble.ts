import type { BuildingPart } from "./building-recipe";
import { CATAPULT_SHAFT_HEIGHT } from "./catapult-dimensions";

/** The entire exterior is a continuous bonded masonry face, not attached spherical boulders. */
export const catapultIndigenousRubble = (_detailed: boolean): BuildingPart[] => [{
  architecture:true,shape:"indigenous-rubble-masonry",surface:"stone",stage:1,catapultRubble:true,
  position:[0,CATAPULT_SHAFT_HEIGHT/2,0],size:[1.7,CATAPULT_SHAFT_HEIGHT,1.7],worldUv:5
}];
