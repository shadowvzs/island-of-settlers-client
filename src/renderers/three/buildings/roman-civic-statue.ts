import { BufferGeometry, DataTexture, Float32BufferAttribute, LinearFilter, type MeshStandardMaterial,RGBAFormat, SRGBColorSpace, Vector3 } from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

import { sinHash2 } from "../../../shared/world/noise";

type Point = [number, number, number];
const ivory: Point = [.83, .77, .65], skin: Point = [.70, .45, .30], burgundy: Point = [.36, .075, .105];
const bronze: Point = [.63, .48, .23], hair: Point = [.24, .18, .13];

/** Original painted Roman orator, modelled as a continuous draped sculpture rather than a soldier. */
export const createRomanCivicStatue = (detailed: boolean) => {
  const positions: number[] = [], colors: number[] = [], uv: number[] = [];
  const triangle = (a: Point, b: Point, c: Point, tint: Point) => {
    positions.push(...a, ...b, ...c);
    for (const point of [a,b,c]) {
      const fold = tint === ivory ? .76 + .24*(.5+.5*Math.cos(Math.atan2(point[0],point[2])*5+point[1]*2)) : 1;
      colors.push(tint[0]*fold,tint[1]*fold,tint[2]*fold); uv.push(point[0]+.5,point[1]+.5);
    }
  };
  const quad = (a: Point, b: Point, c: Point, d: Point, tint: Point) => {
    triangle(a, b, c, tint); triangle(a, c, d, tint);
  };
  const rings = (profile: [number, number, number][], sides: number, tint: Point, folded = false, face = false) => {
    const point = (row: number, side: number): Point => {
      const [y, radiusX, radiusZ] = profile[row]!, angle = side * Math.PI * 2 / sides;
      const fold = folded ? 1 + Math.cos(angle * 5 + y * 2) * .075 : 1;
      return [Math.sin(angle) * radiusX * fold, y, Math.cos(angle) * radiusZ * fold];
    };
    for (let row = 0; row < profile.length - 1; row++) for (let side = 0; side < sides; side++) {
      const a = point(row, side), b = point(row, side + 1), c = point(row + 1, side + 1), d = point(row + 1, side);
      const shade = face && c[1] > .46 && (c[2] < .035 || c[1] > .488) ? hair : tint;
      quad(a, b, c, d, shade);
    }
    for (const end of [0, profile.length - 1]) for (let side = 0; side < sides; side++) {
      const center: Point = [0, profile[end]![0], 0];
      if (end === 0) triangle(center, point(end, side + 1), point(end, side), tint);
      else triangle(center, point(end, side), point(end, side + 1), face ? hair : tint);
    }
  };
  const tube = (from: Point, to: Point, radius: number, tint: Point, sides = detailed ? 6 : 4) => {
    const start = new Vector3(...from), axis = new Vector3(...to).sub(start).normalize();
    const u = new Vector3(0, 0, 1).cross(axis).normalize(), v = axis.clone().cross(u);
    const point = (origin: Point, side: number, end: boolean): Point => {
      const angle = side * Math.PI * 2 / sides;
      return new Vector3(...origin).addScaledVector(u, Math.cos(angle) * radius * (end ? .8 : 1))
        .addScaledVector(v, Math.sin(angle) * radius * (end ? .8 : 1)).toArray() as Point;
    };
    for (let side = 0; side < sides; side++)
      quad(point(from, side, false), point(from, side + 1, false), point(to, side + 1, true), point(to, side, true), tint);
  };
  const tetra = (center: Point, size: Point, tint: Point) => {
    const corners: Point[] = [[-.5, -.5, -.5], [.5, -.5, -.5], [0, .5, 0], [0, -.5, .5]];
    const points = corners.map(p => p.map((value, axis) => center[axis]! + value * size[axis]!) as Point);
    for (const face of [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]])
      triangle(points[face[0]!]!, points[face[1]!]!, points[face[2]!]!, tint);
  };
  // The waist-to-hem profile and alternating radii sculpt long folds into the toga itself.
  rings(detailed ? [[-.43,.29,.24],[-.31,.26,.23],[-.10,.22,.20],[.05,.25,.22],[.19,.27,.23],[.25,.16,.18]] :
    [[-.43,.28,.23],[.03,.23,.20],[.25,.17,.18]], detailed ? 10 : 5, ivory, true);
  rings(detailed ? [[.325,.065,.12],[.355,.105,.17],[.405,.128,.21],[.45,.12,.20],[.485,.10,.16],[.50,.055,.08]] :
    [[.325,.07,.12],[.40,.125,.21],[.47,.11,.18],[.50,.055,.08]], detailed ? 12 : 5, skin, false, true);
  tube([0,.245,0],[0,.343,0],.064,skin);
  // Bent left arm gathers the toga; the raised right hand makes a civic speaking gesture.
  tube([-.21,.18,0],[-.32,.04,.10],.062,ivory);
  tube([-.32,.04,.10],[-.22,.06,.25],.048,skin);
  tube([.21,.18,0],[.34,.20,.04],.057,skin);
  tube([.34,.20,.04],[.40,.34,.15],.044,skin);
  tetra([-.21,.055,.27],[.085,.085,.09],skin);
  tetra([.405,.365,.15],[.09,.105,.08],skin);
  for (const side of [-1, 1]) {
    tetra([side * .11,-.47,.07],[.145,.06,.28],[.36,.25,.17]);
    tetra([side * .13,.405,0],[.045,.075,.13],skin);
  }
  // Burgundy pallium anchors on the shoulder and follows the back and left edge of the robe.
  quad([-.24,.24,-.10],[.11,.20,-.18],[.14,-.34,-.20],[-.26,-.35,-.16],burgundy);
  quad([-.24,.25,.11],[-.19,.27,.21],[.23,-.07,.235],[.19,-.10,.22],ivory);
  // The painted pallium also drapes over the left shoulder and down the visible front.
  quad([-.265,.235,.15],[-.275,-.32,.17],[-.13,-.28,.27],[-.10,.22,.26],burgundy);
  quad([-.265,.235,.15],[-.10,.22,.26],[-.12,.25,.23],[-.22,.275,.13],burgundy);
  // A projecting nose and facial planes avoid the old round toy head.
  tetra([0,.405,.235],[.055,.072,.115],skin);
  const bandSides = detailed ? 12 : 6;
  for (let side = 0; side < bandSides; side++) {
    const a = side * Math.PI * 2 / bandSides, b = (side + 1) * Math.PI * 2 / bandSides;
    quad([Math.sin(a)*.125,.466,Math.cos(a)*.203],[Math.sin(b)*.125,.466,Math.cos(b)*.203],
      [Math.sin(b)*.125,.478,Math.cos(b)*.203],[Math.sin(a)*.125,.478,Math.cos(a)*.203],bronze);
  }
  for (let leaf = 0; leaf < (detailed ? 8 : 4); leaf++) {
    const angle = (leaf / (detailed ? 8 : 4)) * Math.PI * 2;
    tetra([Math.sin(angle)*.125,.483,Math.cos(angle)*.203],[.045,.025,.065],bronze);
  }
  if (detailed) {
    for (const side of [-1, 1]) {
      const brow: Point[] = [[side*.026,.432,.195],[side*.078,.435,.178],[side*.078,.442,.179],[side*.026,.442,.196]];
      if (side < 0) brow.reverse();
      quad(brow[0]!,brow[1]!,brow[2]!,brow[3]!,hair);
      tetra([side*.050,.421,.196],[.025,.009,.012],hair);
    }
    quad([-.030,.370,.198],[.030,.370,.198],[.027,.378,.20],[-.027,.378,.20],[.48,.26,.22]);
    for (let finger = 0; finger < 3; finger++)
      tube([.375 + finger*.021,.388,.152],[.377 + finger*.021,.427,.158],.009,skin,4);
    // Small diagonal folds across the gathered chest supplement the sculpted skirt folds.
    for (let fold = 0; fold < 3; fold++) {
      const y = .16 - fold*.055;
      quad([-.14,y,.224],[-.11,y+.015,.235],[.15,y-.13,.235],[.12,y-.145,.224],[.82,.78,.67]);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position",new Float32BufferAttribute(positions,3));
  geometry.setAttribute("color",new Float32BufferAttribute(colors,3));
  geometry.setAttribute("uv",new Float32BufferAttribute(uv,2));
  const sculpt = mergeVertices(geometry, .00001);
  sculpt.computeVertexNormals();
  geometry.dispose();
  return sculpt;
};


/** Subtle worn polychrome grain survives GLB export as an original bitmap material. */
export const createRomanCivicPaint = (source: MeshStandardMaterial,detailed: boolean) => {
  const size = detailed ? 256 : 64, pixels = new Uint8Array(size*size*4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const grain = sinHash2(x, y), mottling = Math.sin(x*.27)*Math.cos(y*.19);
    const value = 221+grain*28+mottling*5, index = (y*size+x)*4;
    pixels[index] = value; pixels[index+1] = value; pixels[index+2] = value; pixels[index+3] = 255;
  }
  const map = new DataTexture(pixels,size,size,RGBAFormat); map.colorSpace = SRGBColorSpace; map.magFilter = map.minFilter = LinearFilter; map.needsUpdate = true;
  const material = source.clone(); material.map = map; material.bumpMap = map;
  material.bumpScale = detailed ? .0015 : 0; material.roughness = .88;
  return material;
};
