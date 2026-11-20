export type FloorHidePoint = readonly [x: number, z: number];

/** Broad overlapping limb ends have rounded paws, rather than pointed radial spikes. */
const lobes = [[.30, .25, .21, .105, .65], [-.31, .24, .21, .105, -.64],
  [.30, -.26, .22, .115, -.65], [-.29, -.26, .21, .11, .65],
  [0, .36, .14, .11, 0], [0, -.35, .08, .06, 0]] as const;

const ellipseRadius = (angle: number, lobe: readonly number[]) => {
  const [x, z, length, width, yaw] = lobe as readonly [number, number, number, number, number];
  const cosine = Math.cos(yaw), sine = Math.sin(yaw);
  const dx = Math.sin(angle) * cosine + Math.cos(angle) * sine;
  const dz = -Math.sin(angle) * sine + Math.cos(angle) * cosine;
  const cx = x * cosine + z * sine, cz = -x * sine + z * cosine;
  const a = (dx / length) ** 2 + (dz / width) ** 2;
  const b = -2 * (dx * cx / length ** 2 + dz * cz / width ** 2);
  const c = (cx / length) ** 2 + (cz / width) ** 2 - 1;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return 0;
  return Math.max(0, (-b + Math.sqrt(discriminant)) / (2 * a));
};

const radius = (angle: number) => {
  const body = (Math.abs(Math.sin(angle) / .29) ** 2.4 +
    Math.abs(Math.cos(angle) / .37) ** 2.4) ** (-1 / 2.4);
  return Math.max(body, ...lobes.map(lobe => ellipseRadius(angle, lobe))) +
    .004 * Math.sin(angle * 7 + .6) + .003 * Math.sin(angle * 13 + 1.7);
};

const outlines = new Map<number, readonly FloorHidePoint[]>();

/** Original organic cut edge; this is interior decor, independent of production hide wares. */
export const indigenousFloorHideOutline = (count: number): readonly FloorHidePoint[] => {
  const cached = outlines.get(count);
  if (cached) return cached;
  const raw = Array.from({ length: 720 }, (_, index): FloorHidePoint => {
    const angle = index / 720 * Math.PI * 2, distance = radius(angle);
    return [Math.sin(angle) * distance, Math.cos(angle) * distance];
  });
  const xs = raw.map(point => point[0]), zs = raw.map(point => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const normalized = raw.map(([x, z]): FloorHidePoint =>
    [(x - minX) / (maxX - minX) - .5, (z - minZ) / (maxZ - minZ) - .5]);
  const lengths = [0];
  for (let index = 0; index < normalized.length; index++) {
    const a = normalized[index]!, b = normalized[(index + 1) % normalized.length]!;
    lengths.push(lengths[index]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  let edge = 0;
  const outline = Array.from({ length: count }, (_, index): FloorHidePoint => {
    const target = index / count * lengths[normalized.length]!;
    while (lengths[edge + 1]! < target) edge++;
    const a = normalized[edge]!, b = normalized[(edge + 1) % normalized.length]!;
    const t = (target - lengths[edge]!) / (lengths[edge + 1]! - lengths[edge]!);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  });
  outlines.set(count, outline);
  return outline;
};

/** A thin relaxed pile with shallow irregular folds, seated above a flat continuous underside. */
export const indigenousFloorHideHeight = (x: number, z: number, ring: number) =>
  -.04 + .15 * (1 - ring * ring) + .055 * Math.sin(x * 17 + z * 5) *
    Math.sin(z * 11 + .8) * ring * (1 - ring);
