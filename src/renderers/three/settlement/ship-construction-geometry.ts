import { BufferAttribute, BufferGeometry } from "three";

/** Clips real triangles at course boundaries, avoiding long diagonal scraps during construction. */
export const sliceShipGeometry = (geometry: BufferGeometry, count: number, axis: "x" | "y" | "z",
  own: <T extends BufferGeometry>(geometry: T) => T, reverse = false,
  range?: { minimum: number; maximum: number }) => {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const names = Object.keys(source.attributes), offsets = new Map<string, number>();
  let stride = 0;
  for (const name of names) { offsets.set(name, stride); stride += source.getAttribute(name).itemSize; }
  const coordinate = offsets.get("position")! + { x: 0, y: 1, z: 2 }[axis];
  source.computeBoundingBox();
  const minimum = range?.minimum ?? source.boundingBox?.min[axis] ?? 0;
  const maximum = range?.maximum ?? source.boundingBox?.max[axis] ?? 1;
  const span = maximum - minimum || 1;
  const buffers = Array.from({ length: count }, () => [] as number[][]);
  const clip = (polygon: number[][], boundary: number, above: boolean) => {
    const result: number[][] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
      const insideA = above ? a[coordinate]! >= boundary : a[coordinate]! <= boundary;
      const insideB = above ? b[coordinate]! >= boundary : b[coordinate]! <= boundary;
      if (insideA) result.push(a);
      if (insideA === insideB) continue;
      const fraction = (boundary - a[coordinate]!) / (b[coordinate]! - a[coordinate]!);
      result.push(a.map((value, component) => value + fraction * (b[component]! - value)));
    }
    return result;
  };
  for (let triangle = 0; triangle < source.getAttribute("position").count; triangle += 3) {
    const vertices = [0, 1, 2].map(vertex => names.flatMap(name => {
      const attribute = source.getAttribute(name);
      return Array.from({ length: attribute.itemSize }, (_, component) =>
        Number(attribute.array[(triangle + vertex) * attribute.itemSize + component]));
    }));
    const low = Math.min(...vertices.map(vertex => vertex[coordinate]!));
    const high = Math.max(...vertices.map(vertex => vertex[coordinate]!));
    const flatBand = high - low < 1e-10
      ? Math.max(0, Math.min(count - 1, Math.floor((low - minimum) / span * count))) : undefined;
    for (let band = 0; band < count; band++) {
      if (flatBand !== undefined && band !== flatBand) continue;
      const polygon = clip(clip(vertices, minimum + span * band / count, true),
        minimum + span * (band + 1) / count, false);
      const target = buffers[reverse ? count - 1 - band : band]!;
      for (let point = 1; point + 1 < polygon.length; point++)
        target.push(polygon[0]!, polygon[point]!, polygon[point + 1]!);
    }
  }
  const result = buffers.map(vertices => {
    const slice = new BufferGeometry();
    for (const name of names) {
      const attribute = source.getAttribute(name), offset = offsets.get(name)!;
      slice.setAttribute(name, new BufferAttribute(new Float32Array(vertices.flatMap(vertex =>
        vertex.slice(offset, offset + attribute.itemSize))), attribute.itemSize, attribute.normalized));
    }
    slice.computeBoundingSphere();
    return own(slice);
  });
  if (source !== geometry) source.dispose();
  return result;
};
