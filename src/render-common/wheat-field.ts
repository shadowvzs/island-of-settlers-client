import { sinHash2 } from "../shared/world/noise";
import { createFlaxDryingMesh } from "./props/flax-drying";

/** Original wheat morphology: tapered arching leaves, alternating grains and fine awns. */
export interface WheatMeshData {
  positions: number[]; colors: number[]; uvs: number[]; flex: number[]; normals: number[];
}
export const wheatRandom = (seed: number) => sinHash2(seed, 1);
export const wheatPatchRadius = (angle: number, seed: number) =>
  .69 * (1 + .08 * Math.sin(angle * 3 + seed) + .045 * Math.cos(angle * 5 - seed));
export type FieldCrop = "wheat" | "flax";
export const createWheatMeshData = (
  seed: number, detailed: boolean, crop: FieldCrop = "wheat"
): WheatMeshData => {
  const data: WheatMeshData = { positions: [], colors: [], uvs: [], flex: [], normals: [] };
  const vertex = (p: number[], color: number[], uv: number[], normal: number[] = [0, 0, 1]) => {
    data.positions.push(...p); data.colors.push(...color); data.uvs.push(...uv);
    data.flex.push(Math.max(0, p[1]!)); data.normals.push(...normal);
  };
  const unit = (v: number[]) => { const length = Math.hypot(...v) || 1; return v.map(value => value / length); };
  const triangle = (a: number[], b: number[], c: number[], color: number[], normals?: number[][],
    uvs = [[0, 0], [1, 0], [.5, 1]]) => {
    const ab = b.map((value, index) => value - a[index]!), ac = c.map((value, index) => value - a[index]!);
    const face = unit([ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!]);
    [a, b, c].forEach((point, index) => vertex(point, color, uvs[index]!, normals?.[index] ?? face));
  };
  const cropCounts = crop === "flax" ? { detailed: 72, minimal: 32 } : { detailed: 65, minimal: 28 };
  const count = detailed ? cropCounts.detailed : cropCounts.minimal;
  for (let i = 0; i < count; i++) {
    const angle = i * 2.399963 + seed, radius = Math.sqrt((i + .5) / count) * wheatPatchRadius(angle, seed);
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    const height = crop === "flax"
      ? .5 + wheatRandom(i + seed) * .2
      : .58 + wheatRandom(i + seed) * .23;
    if (!detailed) {
      for (let side = 0; side < 2; side++) {
        const a = angle + side * Math.PI / 2, dx = Math.cos(a) * .135, dz = Math.sin(a) * .135;
        const points = [[x - dx, 0, z - dz], [x + dx, 0, z + dz],
          [x + dx, height, z + dz], [x - dx, height, z - dz]];
        for (const corner of [0, 1, 2, 0, 2, 3]) vertex(points[corner]!, [1, 1, 1],
          [[0, 0], [1, 0], [1, 1], [0, 1]][corner]!);
      }
      continue;
    }
    const hue = .85 + wheatRandom(i * 3 + seed) * .15;
    const leafColor = crop === "flax" ? [.1 * hue, .27 * hue, .06 * hue]
      : [.075 * hue, .23 * hue, .025 * hue];
    const stemColor = crop === "flax" ? [.17 * hue, .3 * hue, .09 * hue]
      : [.24 * hue, .34 * hue, .075 * hue];
    const grainColor = [.28 * hue, .38 * hue, .085 * hue];
    const leanX = Math.cos(angle) * .045, leanZ = Math.sin(angle) * .045;
    const stemRing = Array.from({ length: 3 }, (_, side) => {
      const direction = side / 3 * Math.PI * 2;
      return [Math.cos(direction) * .0032, Math.sin(direction) * .0032];
    });
    for (let side = 0; side < 3; side++) {
      const before = stemRing[side]!, after = stemRing[(side + 1) % 3]!;
      const a = [x + before[0]!, 0, z + before[1]!];
      const b = [x + after[0]!, 0, z + after[1]!];
      const c = [x + leanX + after[0]! * .7, height, z + leanZ + after[1]! * .7];
      const d = [x + leanX + before[0]! * .7, height, z + leanZ + before[1]! * .7];
      triangle(a, b, c, stemColor); triangle(a, c, d, stemColor);
    }
    for (let leaf = 0; leaf < 3; leaf++) {
      const a = angle + leaf * 2.4, y = height * (.13 + leaf * .13);
      const length = .25 + wheatRandom(i + leaf * 12) * .15, width = .009;
      const dx = Math.cos(a), dz = Math.sin(a);
      const sections = Array.from({ length: 4 }, (_, index) => {
        const t = index / 3, halfWidth = width * Math.sin(Math.PI * t);
        const yCurve = y + Math.sin(t * Math.PI) * .075 - t * t * .075;
        const curl = Math.sin(t * Math.PI) * width * Math.sin(a + t * 2.5);
        return [[x + dx * length * t - dz * halfWidth, yCurve - curl, z + dz * length * t + dx * halfWidth],
          [x + dx * length * t + dz * halfWidth, yCurve + curl, z + dz * length * t - dx * halfWidth]];
      });
      for (let section = 0; section < 3; section++) {
        const before = sections[section]!, after = sections[section + 1]!;
        const normal = (index: number) => {
          const t = index / 3, dy = Math.cos(t * Math.PI) * Math.PI * .075 - t * .15;
          return unit([dx * dy, -length, dz * dy]);
        };
        const n0 = normal(section), n1 = normal(section + 1), v0 = section / 3, v1 = (section + 1) / 3;
        triangle(before[0]!, before[1]!, after[1]!, leafColor, [n0, n0, n1], [[0, v0], [1, v0], [1, v1]]);
        triangle(before[0]!, after[1]!, after[0]!, leafColor, [n0, n1, n1], [[0, v0], [1, v1], [0, v1]]);
      }
    }
    const headAngle = angle + .4;
    const headX = Math.cos(headAngle), headZ = Math.sin(headAngle);
    const bend = .001 + wheatRandom(seed + i * 17) * .003;
    if (crop === "flax") {
      // A second slender stem and round seed bolls make a flax plant, not a recoloured wheat stalk.
      const branchAngle = angle + 1.3, branchTop = [x + Math.cos(branchAngle) * .045, height * .92,
        z + Math.sin(branchAngle) * .045];
      for (let side = 0; side < 3; side++) {
        const a = side / 3 * Math.PI * 2, next = (side + 1) / 3 * Math.PI * 2;
        triangle([x + Math.cos(a) * .002, 0, z + Math.sin(a) * .002],
          [x + Math.cos(next) * .002, 0, z + Math.sin(next) * .002], branchTop, stemColor);
      }
      const bollColor = [.32 * hue, .4 * hue, .13 * hue], bollRadius = .009;
      for (let boll = 0; boll < 3; boll++) {
        const bollAngle = headAngle + boll * 2.1;
        const bx = x + leanX + Math.cos(bollAngle) * .03;
        const bz = z + leanZ + Math.sin(bollAngle) * .03;
        const by = height * .74 + boll * .035;
        for (let side = 0; side < 4; side++) {
          const a = side / 4 * Math.PI * 2, next = (side + 1) / 4 * Math.PI * 2;
          triangle([bx, by - bollRadius, bz], [bx + Math.cos(a) * bollRadius, by, bz + Math.sin(a) * bollRadius],
            [bx + Math.cos(next) * bollRadius, by, bz + Math.sin(next) * bollRadius], bollColor);
        }
      }
      // Three blue flax flowers replace the grain head; the stem and narrow leaves stay.
      for (let flower = 0; flower < 3; flower++) {
        const flowerAngle = headAngle + flower * 2.2;
        const flowerX = x + leanX + Math.cos(flowerAngle) * .035;
        const flowerZ = z + leanZ + Math.sin(flowerAngle) * .035;
        const flowerY = height + .02 + flower * .022;
        const center = [flowerX, flowerY, flowerZ];
        const petalColor = [.22, .34, .78];
        for (let petal = 0; petal < 5; petal++) {
          const a = petal / 5 * Math.PI * 2, next = (petal + 1) / 5 * Math.PI * 2;
          triangle(center,
            [flowerX + Math.cos(a) * .028, flowerY + .007, flowerZ + Math.sin(a) * .028],
            [flowerX + Math.cos(next) * .028, flowerY + .007, flowerZ + Math.sin(next) * .028],
            petalColor);
        }
      }
      continue;
    }
    for (let grain = 0; grain < 8; grain++) {
      const side = grain % 2 ? 1 : -1, y = height + grain * .014;
      const taper = 1 - grain * .035;
      const center = [x + leanX + headX * (side * .01 * taper + grain * bend),
        y + .014, z + leanZ + headZ * (side * .01 * taper + grain * bend)];
      const bottom = [center[0]! - headX * side * .005, y, center[2]! - headZ * side * .005];
      const tip = [center[0]! + headX * side * .009, y + .029, center[2]! + headZ * side * .009];
      const ring = Array.from({ length: 4 }, (_, corner) => {
        const direction = corner / 4 * Math.PI * 2;
        return [center[0]! + Math.cos(direction) * .009 * taper,
          center[1]!, center[2]! + Math.sin(direction) * .009 * taper];
      });
      for (let corner = 0; corner < 4; corner++) {
        const next = ring[(corner + 1) % 4]!;
        // Analytic ellipsoid normals round the lighting without adding geometry or draw calls.
        const normal = (point: number[]) => unit([(point[0]! - center[0]!) / (.009 * taper) ** 2,
          (point[1]! - center[1]!) / .015 ** 2, (point[2]! - center[2]!) / (.009 * taper) ** 2]);
        triangle(bottom, ring[corner]!, next, grainColor, [normal(bottom), normal(ring[corner]!), normal(next)]);
        triangle(tip, next, ring[corner]!, grainColor, [normal(tip), normal(next), normal(ring[corner]!)]);
      }
      const awn = [tip[0]! + headX * side * .018, tip[1]! + .07 + grain * .004,
        tip[2]! + headZ * side * .018];
      triangle(tip, [tip[0]! + .0007, tip[1]!, tip[2]! + .0007], awn, grainColor);
    }
  }
  return data;
};

interface StubShape { color: readonly number[]; height: number; sides: number; turn: number; }

/** One cut straw stub: a thin pyramid of `sides` faces rising from the soil at (x, z). */
const pushStub = (data: WheatMeshData, x: number, z: number, { color, height, sides, turn }: StubShape) => {
  for (let side = 0; side < sides; side++) {
    const a = turn + side / sides * Math.PI * 2, next = turn + (side + 1) / sides * Math.PI * 2;
    const corners = [[x, 0, z], [x + Math.cos(a) * .012, height, z + Math.sin(a) * .012],
      [x + Math.cos(next) * .012, height, z + Math.sin(next) * .012]];
    for (const point of corners) {
      data.positions.push(...point); data.colors.push(...color); data.normals.push(0, 1, 0);
      data.flex.push(Math.max(0, point[1]!)); data.uvs.push(0, 0);
    }
  }
};

/** Cut flax after the pull: short straw stubs left in the soil, not bare ground. */
export const createFlaxStubbleData = (seed: number, detailed: boolean): WheatMeshData => {
  const data: WheatMeshData = { positions: [], colors: [], flex: [], normals: [], uvs: [] };
  const count = detailed ? 30 : 14, sides = detailed ? 3 : 2;
  for (let index = 0; index < count; index++) {
    const angle = index * 2.399963 + seed, radius = Math.sqrt((index + .5) / count) * .62;
    const color = index % 3 ? [.34, .31, .12] : [.28, .36, .12];
    pushStub(data, Math.cos(angle) * radius, Math.sin(angle) * radius, { color, height: .13, sides, turn: angle });
  }
  return data;
};

/**
 * Harvested grain (ground-palette-4): short golden straw stubble standing in straight rows on the furrow ridges
 * (`rowOffset`: local x of a ridge, `rowSpacing` apart, along z), so a cut plot reads as a tidy field, not a bare
 * round soil stain. Stubs stay inside the patch outline.
 */
export const createGrainStubbleData = (
  seed: number, detailed: boolean, rowOffset: number, rowSpacing: number
): WheatMeshData => {
  const data: WheatMeshData = { positions: [], colors: [], flex: [], normals: [], uvs: [] };
  const step = detailed ? .075 : .15, sides = detailed ? 3 : 2;
  const first = rowOffset - Math.ceil((rowOffset + .7) / rowSpacing) * rowSpacing;
  for (let x = first, row = 0; x <= .7; x += rowSpacing, row++) {
    for (let z = -.7, index = 0; z <= .7; z += step, index++) {
      const jitter = wheatRandom(seed * 131 + row * 37 + index) - .5;
      const stubZ = z + jitter * step * .5, stubX = x + (wheatRandom(seed + row * 53 + index * 7) - .5) * .03;
      if (Math.hypot(stubX, stubZ) > wheatPatchRadius(Math.atan2(stubZ, stubX), seed) * .8) continue;
      const color = index % 3 ? [.46, .38, .17] : [.38, .32, .14];
      pushStub(data, stubX, stubZ, { color, height: .045 + (jitter + .5) * .03, sides, turn: jitter * 6 });
    }
  }
  return data;
};

/** Drying stalks use the shared tied-stem model, expanded into the field's static mesh format. */
export const createFlaxDryingData = (seed: number, detailed: boolean): WheatMeshData => {
  const mesh = createFlaxDryingMesh(seed, detailed);
  const data: WheatMeshData = { positions: [], colors: [], flex: [], normals: [], uvs: [] };
  for (const index of mesh.indices) {
    data.positions.push(...mesh.positions.subarray(index * 3, index * 3 + 3));
    data.colors.push(...mesh.colors.subarray(index * 3, index * 3 + 3));
    data.normals.push(...mesh.normals.subarray(index * 3, index * 3 + 3));
    data.uvs.push(0, 0);
    data.flex.push(0);
  }
  return data;
};
