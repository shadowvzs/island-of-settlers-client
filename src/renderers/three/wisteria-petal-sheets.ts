import { BufferGeometry, Float32BufferAttribute } from "three";

type Point = readonly [number, number, number];

export const WISTERIA_BANNER_CENTER: Point = [0, .35, .24];
export const WISTERIA_BANNER_OUTLINE: readonly Point[] = [
  [0, .06, .10], [.30, .14, .13], [.48, .39, .14], [.32, .65, -.01],
  [0, .60, -.045], [-.32, .65, -.01], [-.48, .39, .14], [-.30, .14, .13]
];

/** Opt-in study: thin cupped tissue sheets, with the original alpha artwork defining rounded edges. */
export const createWisteriaPetalSheets = () => {
  const positions: number[] = [], colours: number[] = [], uv: number[] = [], indices: number[] = [];
  const sheet = (points: readonly Point[], faces: readonly number[], shade: number) => {
    const offset = positions.length / 3;
    for (const point of points) {
      positions.push(...point); colours.push(shade, shade, shade);
      uv.push(point[0] + .5, (point[1] + .45) / 1.1);
    }
    indices.push(...faces.map(vertex => vertex + offset));
  };
  // Preserve the liked cupped banner and its attached pale throat exactly; simplify only thin wings/keel.
  const bannerFaces = WISTERIA_BANNER_OUTLINE.flatMap((_, index) =>
    [0, index + 1, (index + 1) % WISTERIA_BANNER_OUTLINE.length + 1]);
  sheet([WISTERIA_BANNER_CENTER, ...WISTERIA_BANNER_OUTLINE], bannerFaces, .97);
  for (const side of [-1, 1]) sheet([
    [side * .035, -.29, .34], [side * .34, -.29, .27],
    [side * .035, .035, .09], [side * .34, .035, .18]
  ], side < 0 ? [0, 2, 1, 1, 2, 3] : [0, 1, 2, 1, 3, 2], .88);
  sheet([[-.10, -.36, .46], [.10, -.36, .46], [-.10, -.03, .18], [.10, -.03, .18]],
    [0, 1, 2, 1, 3, 2], .84);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};
