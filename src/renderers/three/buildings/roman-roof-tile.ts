import { BufferGeometry, Float32BufferAttribute } from "three";

/** Eight visible crown/lap triangles; the retained roof plane covers buried faces. */
export const createRomanRoofTile = () => {
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [];
  const strips = 3;
  const normal = (x: number, y: number, z: number) => {
    const length = Math.hypot(x, y, z);
    return [x / length, y / length, z / length];
  };
  const point = (end: number, strip: number) => {
    const angle = (strip * Math.PI) / strips;
    return [end - 0.5, Math.sin(angle) * (0.4 + end * 0.12), Math.cos(angle) * 0.5];
  };
  const crownNormal = (end: number, strip: number) => {
    const angle = (strip * Math.PI) / strips;
    const upward = Math.sin(angle) * 0.5;
    return normal(
      -0.12 * Math.sin(angle) * upward,
      upward,
      Math.cos(angle) * (0.4 + end * 0.12)
    );
  };
  const vertex = (position: number[], direction: number[]) => {
    positions.push(...position);
    normals.push(...direction);
    uvs.push(position[0]! + 0.5, position[2]! + 0.5);
  };
  const triangle = (a: number[], b: number[], c: number[], direction: number[]) => {
    vertex(a, direction);
    vertex(b, direction);
    vertex(c, direction);
  };
  for (let strip = 0; strip < strips; strip++) {
    const a = point(0, strip),
      b = point(1, strip);
    const c = point(1, strip + 1),
      d = point(0, strip + 1);
    const start = crownNormal(0, strip),
      end = crownNormal(0, strip + 1);
    const farStart = crownNormal(1, strip),
      farEnd = crownNormal(1, strip + 1);
    vertex(a, start);
    vertex(b, farStart);
    vertex(c, farEnd);
    vertex(a, start);
    vertex(c, farEnd);
    vertex(d, end);
  }
  const anchor = point(1, 0);
  const direction = [1, 0, 0];
  for (let strip = 1; strip < strips; strip++) {
    triangle(anchor, point(1, strip + 1), point(1, strip), direction);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  return geometry;
};
