import { BufferGeometry, Float32BufferAttribute } from "three";

import { CATAPULT_SHAFT_HEIGHT } from "../../../render-common/buildings/catapult-dimensions";
import { catapultShellInnerRadius, catapultShellOuterRadius } from "../../../render-common/buildings/catapult-national-shell-profile";
import { indigenousRubbleSurfaces } from "./indigenous-rubble-layout";
import { clipRubbleSurface, type RubbleSurface, type RubbleSurfaceVertex }
  from "./indigenous-rubble-stones";

const corner = Math.atan((.765 - .15) / .765);
const wallKnots = [0, corner, Math.PI / 2 - corner, Math.PI / 2 + corner, Math.PI - corner,
  Math.PI + corner, Math.PI * 1.5 - corner, Math.PI * 1.5 + corner, Math.PI * 2 - corner, Math.PI * 2]
  .map(angle => angle * .83);

/** Genuine well-family rock volumes; mortar supports the wall but is visible only in its narrow joints. */
export const createIndigenousRubbleMasonry = (detailed: boolean) => {
  const positions: number[] = [], uvs: number[] = [], colours: number[] = [];
  const vertex = ({ colour, depth, point }: RubbleSurfaceVertex) => {
    const angle = point[0] / .83, y = point[1];
    const uneven = .008 * Math.sin(angle * 7 + .8) + .006 * Math.sin(angle * 11 - .3);
    const radius = catapultShellOuterRadius("indigenous", angle, y) - uneven + depth;
    positions.push(Math.sin(angle) * radius / 1.7, y / CATAPULT_SHAFT_HEIGHT - .5, Math.cos(angle) * radius / 1.7);
    uvs.push(point[0] * 2.3, y * 2.3); colours.push(...colour);
  };
  const polygon = (surface: RubbleSurface, splitPlanes=true) => {
    if(!splitPlanes) {
      for(let index=1;index<surface.length-1;index++) {
        vertex(surface[0]!);vertex(surface[index]!);vertex(surface[index+1]!);
      }
      return;
    }
    for (let section = 0; section < wallKnots.length - 1; section++) {
      const clipped = clipRubbleSurface(clipRubbleSurface(surface, 1, 0, wallKnots[section]!),
        -1, 0, -wallKnots[section + 1]!);
      for (let index = 1; index < clipped.length - 1; index++) {
        vertex(clipped[0]!); vertex(clipped[index]!); vertex(clipped[index + 1]!);
      }
    }
  };
  const width = Math.PI * 2 * .83, levels = [0, CATAPULT_SHAFT_HEIGHT - .9,
    CATAPULT_SHAFT_HEIGHT - .7, CATAPULT_SHAFT_HEIGHT];
  for (let row = 0; row < levels.length - 1; row++) {
    const low = levels[row]!, high = levels[row + 1]!;
    polygon([[0, low], [width, low], [width, high], [0, high]].map(point => ({
      point: point as [number, number], depth: -.07, colour: [.66, .66, .65]
    })));
  }
  for (const surface of indigenousRubbleSurfaces(detailed)) polygon(surface,false);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals(); return geometry;
};

/** Coarse LOD chords must never cut into the exact inner stair/hatch envelope. */
export const seatIndigenousMasonryOutsideCavity=(geometry:BufferGeometry)=>{
  const positions=geometry.getAttribute("position");
  for(let vertex=0;vertex<positions.count;vertex++){
    const x=positions.getX(vertex),y=positions.getY(vertex),z=positions.getZ(vertex);
    const radius=Math.hypot(x,z),angle=Math.atan2(x,z);
    const minimum=catapultShellInnerRadius("indigenous",angle,y)+.008;
    if(radius>=minimum)continue;
    positions.setXYZ(vertex,Math.sin(angle)*minimum,y,Math.cos(angle)*minimum);
  }
  geometry.computeVertexNormals();return geometry;
};
