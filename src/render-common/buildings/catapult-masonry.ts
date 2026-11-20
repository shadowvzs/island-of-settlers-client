import type { BuildingPart, BuildingSurface, Point3 } from "./building-recipe";

/** Staggered masonry courses with recessed mortar, without expanding the authored wall envelope. */
export const addCatapultMasonry = (parts: BuildingPart[], surface: BuildingSurface,
  position: Point3, size: Point3, detailed: boolean) => {
  const axis = size[0] >= size[2] ? 0 : 2;
  const depthAxis = axis === 0 ? 2 : 0;
  const length = size[axis], bottom = position[1] - size[1] / 2;
  // Large dressed ashlar keeps readable staggered joints without spending the engine's budget
  // on hundreds of tiny full-depth bevels. The opaque backing and shaft/door/hatch voids stay exact.
  const rows = Math.max(1, Math.round(size[1] / (detailed ? .35 : .46)));
  const rowHeight = size[1] / rows, blockLength = detailed ? .70 : .72;
  const backing = [...size] as Point3;
  backing[depthAxis] = Math.max(.025, backing[depthAxis] - .035);
  parts.push({ position, shape: "box", size: backing, stage: 1, surface,
    tint: [.62, .62, .60], worldUv: 1.8 });
  for (let row = 0; row < rows; row++) {
    let start = -length / 2;
    const first = row % 2 ? blockLength / 2 : blockLength;
    let block = 0;
    while (start < length / 2 - .001) {
      const end = Math.min(length / 2, start + (block === 0 ? first : blockLength));
      const centre = [...position] as Point3, dimensions = [...size] as Point3;
      centre[axis] += (start + end) / 2;
      centre[1] = bottom + (row + .5) * rowHeight;
      dimensions[axis] = Math.max(.008, end - start - .012);
      dimensions[1] = rowHeight - .012;
      const shade = .91 + ((row * 7 + block * 3) % 5) * .022;
      parts.push({ position: centre, shape: detailed ? "bevel-box" : "box", size: dimensions,
        stage: 2, surface, tint: [shade, shade, shade * .985], worldUv: 1.8 });
      start = end; block++;
    }
  }
};
