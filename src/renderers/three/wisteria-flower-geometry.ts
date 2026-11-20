import { BufferGeometry, CylinderGeometry, Float32BufferAttribute } from "three";

import { createWisteriaPetalSheets, WISTERIA_BANNER_CENTER, WISTERIA_BANNER_OUTLINE } from "./wisteria-petal-sheets";

type Point = readonly [number, number, number];

/** Thirty triangles for the complete floret; folds and fine veins belong to shared maps. */
export const createWisteriaFlowerGeometry = (lean = false) => {
  const positions: number[] = [], uvs: number[] = [], colours: number[] = [], indices: number[] = [];
  const vertex = (point: Point, shade: number) => {
    const index = positions.length / 3; positions.push(...point);
    uvs.push(point[0] + .5, (point[1] + .45) / 1.1); colours.push(shade, shade, shade); return index;
  };
  const cup = (centre: Point, outline: readonly Point[], shade: number) => {
    const middle = vertex(centre, shade), rim = outline.map(point => vertex(point, shade));
    for (let index = 0; index < rim.length; index++)
      indices.push(middle, rim[index]!, rim[(index + 1) % rim.length]!);
  };
  cup(WISTERIA_BANNER_CENTER, WISTERIA_BANNER_OUTLINE, .97);
  // Rounded wings wrap the keel; normals interpolate across the cupped lobes.
  for (const side of [-1, 1]) cup([side * .19, -.10, .30], [
    [side * .08, .035, .09], [side * .26, .025, .18], [side * .34, -.10, .27],
    [side * .27, -.25, .34], [side * .13, -.29, .34], [side * .035, -.13, .27]
  ], .88);
  const keel = [[0, -.03, .18], [.10, -.13, .32], [.055, -.31, .43],
    [0, -.36, .46], [-.055, -.31, .43], [-.10, -.13, .32]] as const;
  const k = keel.map(point => vertex(point, .84));
  indices.push(k[0]!, k[1]!, k[2]!, k[0]!, k[2]!, k[3]!,
    k[0]!, k[3]!, k[4]!, k[0]!, k[4]!, k[5]!);
  const petals = lean ? createWisteriaPetalSheets() : new BufferGeometry();
  if (!lean) {
    petals.setAttribute("position", new Float32BufferAttribute(positions, 3));
    petals.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    petals.setAttribute("color", new Float32BufferAttribute(colours, 3));
    petals.setIndex(indices); petals.computeVertexNormals(); petals.computeBoundingBox(); petals.computeBoundingSphere();
  }
  const calyx = new CylinderGeometry(.10, 0, .17, 4, 1, true);
  calyx.rotateX(Math.PI / 2); calyx.translate(0, .03, .005);
  const throat = new BufferGeometry();
  throat.setAttribute("position", new Float32BufferAttribute([
    0, .11, .158, .055, .22, .222, 0, .32, .245, -.055, .22, .222
  ], 3));
  throat.setAttribute("uv", new Float32BufferAttribute([.5, 0, 1, .5, .5, 1, 0, .5], 2));
  throat.setIndex([0, 1, 2, 0, 2, 3]); throat.computeVertexNormals();
  return { petals, calyx, throat, dispose: () => { petals.dispose(); calyx.dispose(); throat.dispose(); } };
};
