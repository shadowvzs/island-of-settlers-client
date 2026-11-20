import { BoxGeometry, Float32BufferAttribute, Group, Mesh, type MeshStandardMaterial } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { BuildingDefinition } from "../../../render-common/buildings/building-catalog";
import { getRomanBuildingWorldSizing } from "../../../render-common/buildings/building-world-sizing";

/** Temporary rear/side work decks keep the front entrance and delivered material bays open. */
export const createConstructionScaffolding = (definition: BuildingDefinition,detailed: boolean,material: MeshStandardMaterial) => {
  const root = new Group();
  root.name = "construction_scaffolding";
  const [width,depth] = definition.gridFootprint;
  const sizing = getRomanBuildingWorldSizing(definition);
  const height = Math.max(.6,Math.min(3.0,sizing.recipe.parts.filter(part=>part.stage===1)
    .reduce((max,part)=>Math.max(max,(part.position[1]+part.size[1]/2)*sizing.scale),1.2)));
  const surfaces: Mesh[] = [];
  const mergedMesh = (parts: BoxGeometry[],name: string) => {
    const geometry = mergeGeometries(parts)!;
    geometry.setAttribute("color",new Float32BufferAttribute(new Float32Array(geometry.getAttribute("position").count*3).fill(1),3));
    parts.forEach(part=>part.dispose());
    const mesh = new Mesh(geometry,material);
    mesh.name = name; mesh.castShadow = detailed; mesh.receiveShadow = true;
    return mesh;
  };
  for (const side of detailed ? [-1,1] : [1]) {
    const geometryParts: BoxGeometry[] = [];
    const beam = (x: number,y: number,z: number,w: number,h: number,d: number,angle = 0) => {
      const geometry = new BoxGeometry(w,h,d);
      geometry.rotateX(angle); geometry.translate(x,y,z); geometryParts.push(geometry);
    };
    const x = side*(width/2-.27), front = -depth*.13, back = -depth*.35;
    const deck = Math.min(height*.60,1.5), top = deck+.52, span = front-back;
    for (const z of [front,back]) {
      beam(x,top/2,z,.075,top,.075);
      beam(x-side*.28,deck/2,z,.065,deck,.065);
    }
    beam(x-side*.14,deck, (front+back)/2,.37,.055,span+.13);
    beam(x,top-.10,(front+back)/2,.045,.045,span);
    beam(x,deck/2,(front+back)/2,.045,Math.hypot(deck,span),.045,Math.atan2(span,deck));
    // Short ladder is a usable connection to the temporary deck, never a wall ornament.
    for (const offset of [-.09,.09]) beam(x-side*.25+offset,deck/2,front+.13,.035,deck,.035);
    const rungs = detailed ? 5 : 3;
    for (let rung = 1; rung <= rungs; rung++) beam(x-side*.25,deck*rung/(rungs+1),front+.13,.22,.025,.025);
    const mesh = mergedMesh(geometryParts,side < 0 ? "construction_scaffold_left" : "construction_scaffold_right");
    surfaces.push(mesh); root.add(mesh);
  }
  // Temporary timber rafters follow each actual authored pitched plane without altering it.
  const rafters: BoxGeometry[] = [];
  for (const part of sizing.recipe.parts.filter(part=>part.surface==="roof" && part.shape==="box" &&
    part.size[0]>.25 && part.size[2]>.25 && part.size[1]<.10).slice(0,9)) {
    for (const position of detailed ? [-.42,-.21,0,.21,.42] : [-.4,0,.4]) {
      const beam = new BoxGeometry(part.size[0],.035,.045);
      beam.translate(0,-.02,position*part.size[2]);
      if (part.rotation) { beam.rotateX(part.rotation[0]); beam.rotateY(part.rotation[1]); beam.rotateZ(part.rotation[2]); }
      beam.translate(...part.position); beam.scale(sizing.scale,sizing.scale,sizing.scale);
      rafters.push(beam);
    }
  }
  const trusses = rafters.length ? mergedMesh(rafters,"construction_roof_trusses") : null;
  if (trusses) root.add(trusses);
  return { root,surfaces,update: (progress: number) => {
    root.visible = definition.style !== "well" && progress >= .08 && progress < .90;
    surfaces.forEach((mesh,index)=> { mesh.visible = index===0 || progress >= .22; });
    if (trusses) {
      trusses.visible = progress >= .60 && progress < .90;
      const fraction = Math.max(0,Math.min(1,(progress-.60)/.08));
      const beams = fraction > 0 ? Math.ceil(fraction*rafters.length) : 1;
      trusses.geometry.setDrawRange(0,beams*36);
    }
  } };
};
