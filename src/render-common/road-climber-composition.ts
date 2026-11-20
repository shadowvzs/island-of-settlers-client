export type ClimberPoint = readonly [number, number, number];
export interface ClimberShoot { id: number; points: readonly ClimberPoint[] }
export interface ClimberPendantSite {
  id: number; shoot: number; at: number; attachment: ClimberPoint; length: number;
  neck: number; yaw: number; drift: readonly [number, number]; tilt: number;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const noise = (seed: number, channel: number) => {
  let value = (seed + Math.imul(channel + 1, 0x9e3779b9)) >>> 0;
  value = Math.imul(value ^ value >>> 16, 0x21f0aaad);
  value = Math.imul(value ^ value >>> 15, 0x735a2d97);
  return ((value ^ value >>> 15) >>> 0) / 4294967296;
};

/** Sample the actual authored segments, so every pendant/leaf axil lies on supporting wood. */
export const sampleClimberShoot = (points: readonly ClimberPoint[], at: number): ClimberPoint => {
  if (points.length < 2) throw new Error("A climber shoot requires joined endpoints");
  const position = clamp(at, 0, 1) * (points.length - 1), first = Math.min(points.length - 2, Math.floor(position));
  const t = position - first, from = points[first]!, to = points[first + 1]!;
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t];
};

/** Botanical groups grow along uneven lateral shoots, not a jittered architectural row. Static and seeded. */
export const createClimberPendantComposition = (count: number, seed: number,
  supportAt: (at: number, side: -1 | 1) => ClimberPoint, options: { minimumTipRise?: number } = {}) => {
  if (!Number.isSafeInteger(count) || count < 3) throw new Error("Invalid climber pendant count");
  const groups = count >= 20 ? 7 : Math.min(4, Math.ceil(count / 2));
  const sizes = Array.from({ length: groups }, () => 1);
  for (let index = groups; index < count; index++) {
    const group = Math.floor(noise(seed, index) * groups);
    sizes[group] = sizes[group]! + 1;
  }
  const sides: (-1 | 1)[] = Array.from({ length: groups }, (_, index) => index % 2 ? -1 : 1);
  for (let index = groups - 1; index > 0; index--) {
    const other = Math.floor(noise(seed, 1800 + index) * (index + 1));
    [sides[index], sides[other]] = [sides[other]!, sides[index]!];
  }
  const shoots: ClimberShoot[] = [], sites: ClimberPendantSite[] = [];
  for (let group = 0; group < groups; group++) {
    const channel = 100 + group * 19, n = (offset: number) => noise(seed, channel + offset);
    const at = clamp((group + .5) / groups + (n(0) - .5) * .085, .025, .975);
    const side = sides[group]!, root = supportAt(at, side);
    const dx = (n(2) < .5 ? -1 : 1) * (.13 + n(3) * .18), dz = side * (.055 + n(4) * .15);
    const points: ClimberPoint[] = [root,
      [root[0] + dx * .43, root[1] + .025 + n(5) * .085, root[2] + dz * .43],
      [root[0] + dx, root[1] + Math.max(options.minimumTipRise ?? -Infinity, -.085 + n(6) * .17), root[2] + dz]];
    shoots.push({ id: group, points });
    const members = sizes[group]!;
    for (let member = 0; member < members; member++) {
      const id = sites.length, u = clamp(.14 + (member + .22 + n(member + 7) * .48) / members * .84, .14, 1);
      sites.push({ id, shoot: group, at: u, attachment: sampleClimberShoot(points, u),
        length: .22 + noise(seed, 800 + id) * .27, neck: .025 + noise(seed, 900 + id) * .024,
        yaw: noise(seed, 1000 + id) * Math.PI * 2,
        drift: [(noise(seed, 1100 + id) - .5) * .045, (noise(seed, 1200 + id) - .5) * .045],
        tilt: (noise(seed, 1300 + id) - .5) * .18 });
    }
  }
  return { shoots, sites };
};
