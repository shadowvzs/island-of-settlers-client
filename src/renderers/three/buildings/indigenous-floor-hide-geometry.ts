import { BufferGeometry, Float32BufferAttribute } from "three";

import {
  indigenousFloorHideHeight, indigenousFloorHideOutline
} from "../../../render-common/props/indigenous-floor-hide-profile";

/** One closed floor-conforming skin: continuous fur surface, cut rim and grounded underside. */
export const createIndigenousFloorHideGeometry = (detailed: boolean) => {
  const outline = indigenousFloorHideOutline(detailed ? 64 : 48), count = outline.length;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const vertex = (x: number, y: number, z: number) => {
    positions.push(x, y, z); uvs.push(x + .5, z + .5);
    return positions.length / 3 - 1;
  };
  const centre = vertex(0, indigenousFloorHideHeight(0, 0, 0), 0);
  let inner: number[] = [];
  for (const ring of detailed ? [1 / 3, 2 / 3, 1] : [.55, 1]) {
    const outer = outline.map(([x, z]) => vertex(x * ring,
      indigenousFloorHideHeight(x * ring, z * ring, ring), z * ring));
    for (let index = 0; index < count; index++) {
      const next = (index + 1) % count;
      if (!inner.length) indices.push(centre, outer[index]!, outer[next]!);
      else indices.push(inner[index]!, outer[index]!, outer[next]!,
        inner[index]!, outer[next]!, inner[next]!);
    }
    inner = outer;
  }
  const bottomCentre = vertex(0, -.5, 0);
  const bottom = outline.map(([x, z]) => vertex(x, -.5, z));
  const rim = outline.map(([x, z]) => vertex(x, indigenousFloorHideHeight(x, z, 1), z));
  const rimBottom = outline.map(([x, z]) => vertex(x, -.5, z));
  for (let index = 0; index < count; index++) {
    const next = (index + 1) % count;
    indices.push(bottomCentre, bottom[next]!, bottom[index]!,
      rim[index]!, rimBottom[index]!, rimBottom[next]!, rim[index]!, rimBottom[next]!, rim[next]!);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
};
