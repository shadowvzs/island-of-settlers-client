import { CATAPULT_ANCHORS, catapultStockAnchor } from "../../shared/settlement/catapult-cycle";
import { CATAPULT_ROOF_CAPACITY } from "../../shared/settlement/military-catapult-ammo";
import type { WorkerNation } from "../workers/worker-nation";
import type { BuildingPart, BuildingRecipe, BuildingSurface, Point3 } from "./building-recipe";
import { createWindowShadowPane } from "./building-window-shadows";
import { CATAPULT_DECK_HEIGHT, CATAPULT_HEIGHT_LIFT, CATAPULT_SHAFT_HEIGHT, catapultRoofHeight } from "./catapult-dimensions";
import { CATAPULT_HATCH_WELL } from "./catapult-hatch";
import { catapultIndigenousRubble } from "./catapult-indigenous-rubble";
import { addCatapultMasonry } from "./catapult-masonry";
import { mayaCatapultWallSections } from "./catapult-maya-window-wall";
import {
  CATAPULT_ARM, CATAPULT_CRANK, CATAPULT_ENGINE_SCALE, CATAPULT_HATCH, CATAPULT_SCOOP, CATAPULT_SCOOP_SOCKET, CATAPULT_STONE_DIAMETER, CATAPULT_TRAVERSE, catapultMechanismPoint
} from "./catapult-mechanism";
import { addCatapultNationalFacade } from "./catapult-national-facades";
import { catapultNationalWallFinish, catapultNationalWallSurface } from "./catapult-national-wall-finish";
import { addCatapultPlatform } from "./catapult-platform";
import { createCatapultShellArchitecture } from "./catapult-shell-architecture";
import { catapultWallDetails } from "./catapult-wall-details";

/** Prototype tower: a masonry shaft carries a braced timber throwing engine, without archer balconies. */
export const createCatapultTowerRecipe = (nation: WorkerNation, detailed: boolean): BuildingRecipe => {
  const parts: BuildingPart[] = [];
  const add = (surface: BuildingSurface, position: Point3, size: Point3,
    rotation?: Point3, shape: BuildingPart["shape"] = "box") => {
    const actualShape = detailed && surface === "wood" && shape === "box" ? "bevel-box" : shape;
    parts.push({ position, rotation, shape: actualShape, size, stage: 2, surface, worldUv: 1.8 });
  };
  const stone: BuildingSurface = nation === "maya" || nation === "roman" ? "cut-stone" : "stone";
  const mechanism = (surface: BuildingSurface, position: Point3, size: Point3,
    rotation?: Point3, shape: BuildingPart["shape"] = "box") => {
    add(surface, catapultMechanismPoint(position), size.map(value => value * CATAPULT_ENGINE_SCALE) as Point3,
      rotation, shape);
    parts.at(-1)!.catapultPart = "frame";
  };
  const shaftHeight = CATAPULT_SHAFT_HEIGHT, recessHeight = .70;
  const [hx, , hz] = CATAPULT_HATCH.position, halfWell = CATAPULT_HATCH_WELL.lower / 2;
  const backEdge = hz - halfWell, frontEdge = hz + halfWell;
  const leftEdge = hx - halfWell;
  const pocketInner = CATAPULT_HATCH.hinge[0] - .035;

  const masonry = (position: Point3, size: Point3) =>
    addCatapultMasonry(parts,stone,position,size,detailed);
  if(nation==="maya") {
  // Hollow shaft, with a full-sized front entrance and a clear interior landing.
  add(stone, [0, .06, 0], [1.45, .12, 1.45]);
  parts.at(-1)!.buriedBoxFaces = ["-y"];
  for (const side of [-1, 1]) {
    if (side > 0) masonry([.61, shaftHeight / 2, 0], [.18, shaftHeight, 1.4]);
    else {
      // The downward lid occupies a concealed pocket; the outer wall face remains continuous.
      masonry([-.61, (shaftHeight - recessHeight) / 2, 0], [.18, shaftHeight - recessHeight, 1.4]);
      masonry([(-.7 + leftEdge) / 2, shaftHeight - recessHeight / 2, (-.7 + backEdge) / 2], [leftEdge + .7, recessHeight, backEdge + .7]);
      masonry([(-.7 + leftEdge) / 2, shaftHeight - recessHeight / 2, (.7 + frontEdge) / 2], [leftEdge + .7, recessHeight, .7 - frontEdge]);
      masonry([(-.7 + pocketInner) / 2, shaftHeight - recessHeight / 2, hz], [pocketInner + .7, recessHeight, halfWell * 2]);
    }
    masonry([side * .445, shaftHeight / 2, .61], [.33, shaftHeight, .18]);
  }
  for (const side of [-1, 1]) parts.push(createWindowShadowPane({shape:"box",surface:"dark",stage:2,
    position:[side*.685,catapultRoofHeight(1.12),-.08],size:[.004,.32,.26],windowShadowDecorative:true}));
  masonry([0, (shaftHeight - recessHeight) / 2, -.61], [1.4, shaftHeight - recessHeight, .18]);
  masonry([0, shaftHeight - recessHeight / 2, (-.7 + backEdge) / 2], [1.4, recessHeight, backEdge + .7]);
  masonry([0, 1.25 + CATAPULT_HEIGHT_LIFT / 2, .61], [.56, .8 + CATAPULT_HEIGHT_LIFT, .18]);
  // Dressed jambs and a single bearing lintel keep the doorway readable at gameplay zoom.
  for (const side of [-1, 1]) add(stone, [side * .29, .43, .72], [.085, .86, .11], undefined, "bevel-box");
  add(stone, [0, .88, .72], [.69, .13, .11], undefined, "bevel-box");
  addCatapultNationalFacade(parts, nation, detailed);
  const opened=parts.flatMap(part=>{
    if(part.surface!==stone||!["box","bevel-box"].includes(part.shape))return [part];
    return mayaCatapultWallSections(part.position,part.size).map(section=>({...part,...section}));
  });
  parts.splice(0,parts.length,...opened);
  } else {
    add(stone,[0,.06,0],[1.05,.12,1.05]);
    parts.push({shape:"catapult-national-shell",catapultShellNation:nation,surface:catapultNationalWallSurface(nation),
      position:[0,shaftHeight/2,0],size:[1.7,shaftHeight,1.7],stage:2,worldUv:nation==="japanese"?1:1.8,
      interiorShade:nation==="chinese"?[.30,.31,.33]:[.74,.72,.67]});
    parts.push(...createCatapultShellArchitecture(nation,detailed));
    parts.push(...catapultNationalWallFinish(nation,detailed));
    if(nation==="indigenous")parts.push(...catapultIndigenousRubble(detailed));
  }
  parts.push(...catapultWallDetails(nation));
  addCatapultPlatform(parts, detailed);
  // Timber uprights and cross bracing transmit the engine's load into the masonry.
  for (const side of [-1, 1]) {
    mechanism("wood", [side * .52, 1.99, -.12], [.12, .58, .12]);
    mechanism("wood", [side * .52, 1.95, -.16], [.09, .72, .09], [.52, 0, 0]);
    mechanism("wood", [side * .52, 1.78, 0], [.16, .13, 1.12]);
  }
  mechanism("wood", [0, 2.16, -.12], [.12, 1.23, .12], [0, 0, Math.PI / 2], "cylinder");
  // The shorter engine fits the approved compact tower; its larger scoop remains readable.
  add("wood", [...CATAPULT_ARM.position], [...CATAPULT_ARM.size], [CATAPULT_ARM.pitch, 0, 0]);
  parts.at(-1)!.catapultPart = "arm";
  add("wood", [...CATAPULT_SCOOP_SOCKET.position], [...CATAPULT_SCOOP_SOCKET.size], [CATAPULT_SCOOP.pitch, 0, 0]);
  parts.at(-1)!.catapultPart = "arm";
  add("wood", [...CATAPULT_SCOOP.position], [...CATAPULT_SCOOP.size],
    [CATAPULT_SCOOP.pitch, 0, 0], "catapult-scoop");
  parts.at(-1)!.catapultPart = "arm";
  add("stone", [...CATAPULT_ANCHORS.release],
    [CATAPULT_STONE_DIAMETER, CATAPULT_STONE_DIAMETER, CATAPULT_STONE_DIAMETER], undefined, "catapult-rock");
  parts.at(-1)!.catapultPart = "loaded";
  for (let slot = 0; slot < CATAPULT_ROOF_CAPACITY; slot++) {
    add("stone", [...catapultStockAnchor(slot)],
      [CATAPULT_STONE_DIAMETER, CATAPULT_STONE_DIAMETER, CATAPULT_STONE_DIAMETER],
      [0, slot * 1.83, 0], "catapult-rock");
    parts.at(-1)!.stock = { kind: "input", slot, ware: "stone" };
  }
  const [cx, cy, cz] = CATAPULT_CRANK.pivot;
  // The fixed axle bears on the left upright; keep the original crank pivot and hand contacts.
  const crankUpright = catapultMechanismPoint([-.52, 1.99, -.12]);
  add("wood", [crankUpright[0] - .01, cy, (crankUpright[2] + cz) / 2],
    [.06, .06, Math.abs(cz - crankUpright[2]) + .04]);
  parts.at(-1)!.shape = "box";
  parts.at(-1)!.buriedBoxFaces = ["-z"];
  parts.at(-1)!.catapultPart = "frame";
  add("iron", [cx, cy, cz], [.045, .20, .045], [0, 0, Math.PI / 2], "cylinder");
  parts.at(-1)!.radialSegments=detailed?12:3;
  parts.at(-1)!.catapultPart = "frame";
  add("wood", [cx - .10, cy + CATAPULT_CRANK.radius / 2, cz], [.035, CATAPULT_CRANK.radius, .035]);
  parts.at(-1)!.catapultPart = "crank";
  add("wood", [CATAPULT_CRANK.gripX - .025, cy + CATAPULT_CRANK.radius, cz], [.10, .035, .035]);
  parts.at(-1)!.catapultPart = "crank";
  add("wood", [CATAPULT_CRANK.gripX, cy + CATAPULT_CRANK.radius, cz], [.04, .04, .18]);
  parts.at(-1)!.catapultPart = "crank";
  mechanism("rope", [0, 1.96, -.12], [.15, 1.05, .15], [0, 0, Math.PI / 2], "cylinder");
  // A hand-driven traverse bar and a separate release trip stay outside the throwing arm.
  const [left, right] = CATAPULT_TRAVERSE.hands;
  const grip = left.map((value, axis) => (value + right[axis]!) / 2) as Point3;
  add("iron", [grip[0], (grip[1] + CATAPULT_DECK_HEIGHT) / 2, grip[2]],
    [.035, grip[1] - CATAPULT_DECK_HEIGHT, .035]);
  parts.at(-1)!.catapultPart = "frame";
  add("wood", grip, [.14, .035, .035], [0, Math.atan2(-(left[2] - right[2]), left[0] - right[0]), 0]);
  parts.at(-1)!.catapultPart = "frame";
  add("iron", [...CATAPULT_TRAVERSE.trigger], [.055, .028, .035]);
  parts.at(-1)!.catapultPart = "trigger";
  // Interior stair flights remain concealed by the original solid shaft.
  if (detailed) {
    for (let step = 0; step < 9; step++) {
      add("wood", [.30, .14 + step * .14, .35 - step * .075], [.30, .025, .10]);
      add("wood", [.30 - step * .075, 1.40 + step * .14, -.35], [.12, .025, .30]);
    }
  }
  return { door: [-.23, 0, .72], doorProfile: "flat", mechanism: [0, catapultRoofHeight(2.2), 0], parts, workPoint: [0, CATAPULT_DECK_HEIGHT, -.28], workerExit: [0, 0, 1.02] };
};
