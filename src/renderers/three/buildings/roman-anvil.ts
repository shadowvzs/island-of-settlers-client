import { BufferGeometry, ExtrudeGeometry, Float32BufferAttribute, Shape } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** One connected forged body: flat heel/face, curved waist, broad feet and round tapered horn. */
export const createRomanAnvilGeometry = (detailed: boolean) => {
  const profile = new Shape();
  const points = [
    [-0.48, 0.48],
    [0.1, 0.48],
    [0.1, 0.2],
    [-0.06, 0.04],
    [-0.08, -0.12],
    [0.04, -0.34],
    [0.14, -0.4],
    [0.14, -0.48],
    [-0.44, -0.48],
    [-0.44, -0.4],
    [-0.3, -0.34],
    [-0.21, -0.12],
    [-0.22, 0.04],
    [-0.36, 0.2],
    [-0.48, 0.2]
  ];
  profile.moveTo(...(points[0] as [number, number]));
  for (const point of points.slice(1)) profile.lineTo(...(point as [number, number]));
  profile.closePath();
  const body = new ExtrudeGeometry(profile, {
    depth: detailed ? 0.94 : 1,
    bevelEnabled: detailed,
    bevelSize: 0.025,
    bevelThickness: 0.025,
    bevelSegments: 1,
    steps: 1
  });
  body.translate(0, 0, detailed ? -0.47 : -0.5);
  const horn = new BufferGeometry(),
    positions: number[] = [],
    indices: number[] = [];
  const sections = [
    [0.07, 0.29, 0.16, 0.42],
    [0.23, 0.31, 0.13, 0.3],
    [0.39, 0.35, 0.065, 0.15],
    [0.5, 0.38, 0.008, 0.015]
  ];
  const sides = detailed ? 12 : 6;
  for (const [x, y, height, width] of sections)
    for (let i = 0; i < sides; i++) {
      const angle = (i * Math.PI * 2) / sides;
      positions.push(x!, y! + Math.sin(angle) * height!, Math.cos(angle) * width!);
    }
  for (let ring = 0; ring < sections.length - 1; ring++)
    for (let i = 0; i < sides; i++) {
      const a = ring * sides + i,
        b = ring * sides + ((i + 1) % sides);
      indices.push(a, a + sides, b, b, a + sides, b + sides);
    }
  for (let i = 1; i < sides - 1; i++) {
    const last = (sections.length - 1) * sides;
    indices.push(last, last + i + 1, last + i);
  }
  horn.setAttribute("position", new Float32BufferAttribute(positions, 3));
  horn.setIndex(indices);
  horn.computeVertexNormals();
  horn.setAttribute(
    "uv",
    new Float32BufferAttribute(
      positions.flatMap((_v, i) =>
        i % 3 === 0 ? [positions[i]! + 0.5, positions[i + 1]! + 0.5] : []
      ),
      2
    )
  );
  const flatHorn = horn.toNonIndexed();
  const merged = mergeGeometries([body, flatHorn])!;
  body.dispose();
  horn.dispose();
  flatHorn.dispose();
  return merged;
};
