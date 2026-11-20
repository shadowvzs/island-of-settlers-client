import { DMath } from "../../shared/math/deterministic-math";
import { MILL_TYPE_ID } from "../../shared/settlement/building-type-ids";
import type { BuildingDefinition } from "./building-catalog";
import { addLookoutSpyglassPainting } from "./lookout-spyglass-sign";
import { addRomanBeerPainting } from "./roman-brewery-detail";
import { addRomanGrapePainting } from "./roman-grape-painting";
import type { AddPart } from "./roman-resource-workshops";

type Pigment = [number, number, number];

const getTabletHeight = (id: number, height: number, wallMounted: boolean) => {
  if (wallMounted) return Math.max(1.07, height + 0.12);
  if ([17, 21].includes(id)) return height + 0.1;
  if (id === 2) return 1.46;
  if (id === 20) return 1.2;
  return height + 0.45;
};

const getTabletDepthOffset = (id: number) => {
  if (id === MILL_TYPE_ID) return 0.115;
  if (id === 2) return 0.55;
  if ([17, 20, 21].includes(id)) return 0.08;
  return 0.145;
};

const getTabletDepth = (id: number, depth: number, wallMounted: boolean) =>
  wallMounted ? depth / 2 + 0.082 : depth / 2 + getTabletDepthOffset(id);

const getPrimaryPigment = (task: BuildingDefinition["task"], blue: Pigment, green: Pigment, red: Pigment) => {
  if (task === "fish") return blue;
  if (task === "plant") return green;
  return red;
};

const addPigPictogram = (part: AddPart, x: number, y: number, z: number) => {
  const pigment = (dx:number, dy:number, w:number, h:number, color:[number,number,number],
    layer:number, triangle=false, angle=0) => part("paint", [x+dx,y+dy,z+.028+layer*.002],
      [w,h,.001],3,triangle ? "paint-triangle" : "paint-ellipse",[0,0,angle],color);
  const outline:[number,number,number]=[.15,.065,.055];
  const pink:[number,number,number]=[.94,.56,.48];
  // Paired upright ears and a broad cheek silhouette remain legible at the RTS zoom.
  for(const side of [-1,1]) {
    pigment(side*.054,.034,.058,.063,outline,0,true,side*-.35);
    pigment(side*.054,.034,.047,.051,pink,1,true,side*-.35);
    pigment(side*.054,.037,.025,.032,[.65,.27,.25],2,true,side*-.35);
  }
  pigment(0,-.004,.145,.113,outline,3);
  pigment(0,-.001,.134,.101,pink,4);
  pigment(0,-.022,.112,.055,[.84,.42,.36],5);
  pigment(-.009,.017,.09,.041,[1,.69,.59],5);
  for(const side of [-1,1]) {
    pigment(side*.035,.006,.014,.016,outline,6);
    pigment(side*.034+.002,.01,.004,.004,[1,.95,.82],7);
  }
  // Dark rim, soft snout highlight and two separate nostrils make this unmistakably a pig.
  pigment(0,-.025,.079,.044,[.48,.19,.17],7);
  pigment(0,-.023,.068,.035,[.98,.64,.54],8);
  pigment(-.008,-.015,.043,.014,[1,.76,.64],9);
  for(const side of [-1,1]) pigment(side*.017,-.025,.009,.015,[.3,.105,.09],10);
  pigment(0,-.047,.029,.006,[.48,.19,.17],7);
};

/** Pigment-thin occupation pictograms on small stone tablets, never timber wall panels. */
export const addRomanOccupationPainting = (
  definition: BuildingDefinition,
  part: AddPart,
  width: number,
  depth: number,
  height: number,
  entryX: number,
  wallMounted = false,
  detailed = true
) => {
  if (definition.style === "well") return;
  const x = definition.task === "fish" ? 0 : entryX;
  const y = getTabletHeight(definition.id, height, wallMounted);
  const z = getTabletDepth(definition.id, depth, wallMounted);
  part("stone", [x, y, z], [0.31, 0.18, 0.045], 3);
  const red: [number, number, number] = [0.92, 0.17, 0.1];
  const blue: [number, number, number] = [0.08, 0.43, 0.85];
  const green: [number, number, number] = [0.045, 0.28, 0.07];
  const ochre: [number, number, number] = [1, 0.72, 0.13];
  const primary = getPrimaryPigment(definition.task, blue, green, red);
  const paint = (
    dx: number,
    dy: number,
    w: number,
    h: number,
    angle = 0,
    color = primary,
    layer = 0
  ) => {
    // Dark pigment keyline separates every symbol from the warm masonry tablet.
    part(
      "paint",
      [x + dx, y + dy, z + 0.024 + layer * 0.004],
      [w + 0.007, h + 0.007, 0.002],
      3,
      [19,28,36].includes(definition.id) ? "paint-stroke" : "box",
      [0, 0, angle],
      [0.025, 0.035, 0.04]
    );
    part(
      "paint",
      [x + dx, y + dy, z + 0.026 + layer * 0.004],
      [w, h, 0.002],
      3,
      [19,28,36].includes(definition.id) ? "paint-stroke" : "box",
      [0, 0, angle],
      color
    );
  };
  // Contrasting colored border frames the occupation without changing the stone facade.
  paint(0, -0.076, 0.28, 0.009, 0, ochre);
  paint(0, 0.076, 0.28, 0.009, 0, blue);
  const task = definition.task;
  if (task === "fish") {
    // Hook: straight shank, curved lower return and pointed barb.
    paint(0.032, 0.017, 0.016, 0.09, 0, [0.62, 0.64, 0.66]);
    for (let i = 0; i < 7; i++) {
      const a = (i * Math.PI) / 6;
      paint(
        -0.006 + DMath.cos(a) * 0.038,
        -0.025 - DMath.sin(a) * 0.035,
        0.022,
        0.012,
        -a,
        [0.62, 0.64, 0.66]
      );
    }
    paint(-0.04, -0.014, 0.012, 0.025, -0.5, red);
    paint(0.032, 0.058, 0.025, 0.012, 0, blue);
  } else if (task === "plant") {
    paint(0, -0.026, 0.018, 0.095, 0, [0.42, 0.23, 0.1]);
    for (const [dx, dy, w, h] of [
      [-0.038, 0.013, 0.08, 0.06],
      [0.038, 0.013, 0.08, 0.06],
      [0, 0.039, 0.105, 0.07]
    ])
      part("paint", [x + dx!, y + dy!, z + 0.028], [w!, h!, 0.004], 3, "sphere", undefined, green);
  } else if (task === "fell") {
    paint(0.018, -0.014, 0.018, 0.13, -0.42, [0.44, 0.24, 0.09]);
    paint(-0.013, 0.039, 0.082, 0.045, -0.42, [0.7, 0.71, 0.72]);
    paint(-0.041, 0.026, 0.012, 0.05, -0.42, [0.9, 0.91, 0.92]);
  } else if (task === "quarry") {
    // Straight symmetric pointed crosshead on a perpendicular handle: a pick, never a scythe.
    paint(0, -.014, .018, .123, 0, [.36,.18,.065]);
    paint(.004, -.018, .004, .097, 0, [.7,.43,.18], 1);
    paint(0, .043, .117, .021, 0, [.48,.58,.65], 2);
    paint(0, .049, .105, .004, 0, [.86,.9,.93], 3);
    for(const side of [-1,1]) {
      part("paint",[x+side*.068,y+.043,z+.032],[.035,.033,.001],3,"paint-triangle",
        [0,0,-side*Math.PI/2],[.025,.035,.04]);
      part("paint",[x+side*.067,y+.043,z+.034],[.029,.023,.001],3,"paint-triangle",
        [0,0,-side*Math.PI/2],[.7,.78,.83]);
    }
    paint(0,-.065,.024,.008,0,[.23,.105,.035],1);
  } else if (task === "saw") {
    paint(-0.078, 0, 0.028, 0.064, 0, [0.46, 0.23, 0.09]);
    paint(0.017, 0, 0.16, 0.036, 0, [0.7, 0.71, 0.72]);
    for (let i = 0; i < 6; i++)
      paint(-0.05 + i * 0.025, -0.023, 0.017, 0.017, Math.PI / 4, [0.7, 0.71, 0.72]);
  } else if (task === "forge") {
    // Upright T silhouette: a broad horizontal steel head on one dark timber handle.
    paint(0, -0.017, 0.026, 0.114, 0, [0.3, 0.12, 0.04]);
    paint(0, 0.036, 0.19, 0.052, 0, [0.48, 0.56, 0.63], 1);
    paint(0, 0.056, 0.177, 0.008, 0, [0.77, 0.83, 0.88], 2);
    paint(-0.087, 0.035, 0.015, 0.05, 0, [0.29, 0.36, 0.43], 2);
    paint(0.087, 0.035, 0.015, 0.05, 0, [0.67, 0.73, 0.78], 2);
  } else if (task === "butcher") {
    // Broad steel cleaver and a dark wooden grip, clearly different from the hunter's meat.
    paint(-0.057, -0.02, 0.074, 0.025, 0.28, [0.3, 0.12, 0.05]);
    paint(0.025, 0.007, 0.108, 0.063, 0.28, [0.58, 0.64, 0.69], 1);
    paint(0.017, -0.019, 0.1, 0.009, 0.28, [0.8, 0.84, 0.87], 2);
    paint(0.063, 0.033, 0.009, 0.009, 0, [0.045, 0.055, 0.065], 2);
  } else if (task === "hunt") {
    // Original carried-meat pictogram: red joint with pale exposed bone.
    paint(0.057, -0.032, 0.071, 0.022, -0.5, [0.87, 0.82, 0.67]);
    part(
      "paint",
      [x - 0.02, y + 0.013, z + 0.028],
      [0.15, 0.095, 0.004],
      3,
      "sphere",
      undefined,
      [0.32, 0.12, 0.045]
    );
    part(
      "paint",
      [x - 0.047, y + 0.029, z + 0.032],
      [0.05, 0.023, 0.003],
      3,
      "sphere",
      undefined,
      [0.56, 0.28, 0.11]
    );
    for (const offset of [-0.012, 0.012])
      part(
        "paint",
        [x + 0.087, y - 0.048 + offset, z + 0.028],
        [0.035, 0.026, 0.004],
        3,
        "sphere",
        undefined,
        [0.87, 0.82, 0.67]
      );
  } else if (task === "harvest" && definition.id === 37) {
    paint(0, -0.012, 0.012, 0.13);
    for (let i = 0; i < 3; i++)
      for (const side of [-1, 1]) paint(side * 0.026, -0.02 + i * 0.031, 0.047, 0.014, side * 0.6);
  } else if (task === "harvest" || task === "press") {
    addRomanGrapePainting(part, x, y, z, detailed);
  } else if (task === "mine") {
    paint(0.015, -0.01, 0.013, 0.12, -0.3, [0.44, 0.24, 0.09]);
    paint(-0.018, 0.044, 0.15, 0.016, 0.15, [0.7, 0.71, 0.72]);
  } else if (task === "brew") {
    addRomanBeerPainting(part, x, y, z);
  } else if (task === "draw" || task === "offer") {
    paint(0, -0.006, 0.087, 0.097, 0, task === "draw" ? blue : ochre);
    paint(0.055, 0.007, 0.028, 0.052, 0, ochre);
    paint(0, 0.048, 0.095, 0.015, 0, [0.92, 0.9, 0.8]);
  } else if (task === "bake") {
    part(
      "paint",
      [x, y, z + 0.027],
      [0.19, 0.075, 0.004],
      3,
      "sphere",
      undefined,
      [0.34, 0.14, 0.05]
    );
    for (let i = 0; i < 3; i++)
      paint(-0.05 + i * 0.05, 0.006, 0.007, 0.04, -0.4, [0.14, 0.055, 0.02]);
  } else if (task === "mill") {
    paint(0, -0.006, 0.1, 0.095, 0, [0.86, 0.82, 0.7]);
    paint(0, 0.04, 0.065, 0.017, 0, red);
    paint(0, 0, 0.037, 0.037, Math.PI / 4, ochre);
  } else if (task === "mint") {
    part("paint", [x, y, z + 0.027], [0.115, 0.115, 0.004], 3, "sphere", undefined, ochre);
    paint(0, 0, 0.013, 0.08, 0, red);
  } else if (["skin", "tan", "sew", "butcher"].includes(task)) {
    paint(0, 0, 0.1, 0.08, 0, [0.56, 0.26, 0.12]);
    for (const side of [-1, 1])
      for (const end of [-1, 1])
        paint(side * 0.055, end * 0.036, 0.055, 0.025, side * end * 0.6, [0.56, 0.26, 0.12]);
  } else if (task === "feed" && definition.id === 28) {
    addPigPictogram(part, x, y, z);
  } else if (task === "feed") {
    part(
      "paint",
      [x, y, z + 0.027],
      [0.14, 0.068, 0.004],
      3,
      "sphere",
      undefined,
      definition.id === 28 ? [0.92, 0.44, 0.38] : [0.4, 0.3, 0.22]
    );
    paint(0.075, 0.027, 0.037, 0.051, 0, ochre);
    for (const side of [-1, 1]) paint(side * 0.04, -0.048, 0.011, 0.038, 0, ochre);
  } else if (task === "smelt" || task === "burn") {
    if (task === "burn") {
      paint(0, 0, 0.12, 0.07, 0, [0.08, 0.09, 0.1]);
      paint(0, 0.025, 0.12, 0.01, 0, blue);
    } else {
      // Shaded top, long steel side and angled end make a recognizable cast ingot.
      paint(0, -0.005, 0.15, 0.04, 0, [0.42, 0.49, 0.55]);
      paint(0.008, 0.022, 0.14, 0.022, 0.12, [0.73, 0.78, 0.81], 1);
      paint(0.076, -0.004, 0.02, 0.038, 0.15, [0.25, 0.31, 0.36], 2);
      paint(0, -0.022, 0.145, 0.005, 0, [0.18, 0.23, 0.27], 2);
    }
  } else if (task === "build-ship") {
    // A broad wooden hull on two trestles plus a diagonal shipwright's hammer.
    paint(0, -.018, .136, .029, 0, [.48, .23, .085]);
    paint(-.076, -.006, .049, .029, -.52, [.58, .31, .13]);
    paint(.076, -.006, .049, .029, .52, [.58, .31, .13]);
    paint(0, -.006, .15, .012, 0, [.85, .62, .28], 1);
    for(const side of [-1,1]) paint(side*.049, -.044, .016, .025, side*.2, [.31,.19,.09]);
    paint(-.004, .037, .013, .066, -.56, [.47,.25,.1], 2);
    paint(.01, .056, .058, .026, -.56, [.65,.74,.81], 3);
  } else if (definition.id === 14) {
    addLookoutSpyglassPainting(part, x, y, z);
  } else if (definition.id === 1 || definition.id === 2) {
    // Upright sword: bright steel blade, pointed tip, bronze guard and dark grip.
    paint(0, 0.02, 0.026, 0.078, 0, [0.68, 0.72, 0.76]);
    paint(0, 0.055, 0.023, 0.023, Math.PI / 4, [0.86, 0.9, 0.94], 1);
    paint(-0.007, 0.02, 0.005, 0.074, 0, [0.94, 0.96, 0.98], 1);
    paint(0, -0.025, 0.095, 0.015, 0, ochre, 2);
    paint(0, -0.047, 0.017, 0.032, 0, [0.3, 0.12, 0.055], 2);
    paint(0, -0.065, 0.027, 0.012, 0, ochre, 3);
  } else if (task === "guard" || task === "fire") {
    paint(0, 0, 0.09, 0.12);
    paint(0, 0, 0.013, 0.12, 0, ochre);
  } else {
    // Workshop seal: central product crate with job-specific marks around its edge.
    paint(0, 0, 0.09, 0.075);
    for (let i = 0; i < 1 + (definition.id % 3); i++) paint(-0.09 + i * 0.09, 0.062, 0.022, 0.012);
    paint(0, -0.059, 0.17, 0.01);
  }
};
