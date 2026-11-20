import { ROAD_STONE_WIDTH, ROAD_WIDTH, type RoadPoint } from "../../../shared/settlement/road-types";

type Sample = { point: RoadPoint; width?: number };
type Section = { start: Sample; end: Sample; ribbon: number };

/** Local buckets keep the common crown continuous at overlaps without scanning the road network. */
export const createRoadSurfaceProfile = (ribbons: Sample[][]) => {
  // Canonical ownership makes coincident points agree across meshes built for different tiers.
  const ribbonKey = (samples: Sample[]) => [samples[0], samples.at(-1)].map(sample =>
    `${sample?.point.x}:${sample?.point.z}:${sample?.width ?? ROAD_WIDTH}`).sort().join("/");
  ribbons = [...ribbons].sort((a, b) => ribbonKey(a).localeCompare(ribbonKey(b)));
  const ribbonIds = new Map(ribbons.map((samples, index) => [samples, index]));
  const buckets = new Map<string, Section[]>();
  for (const [ribbon, samples] of ribbons.entries()) for (let index = 1; index < samples.length; index++) {
    const section = { start: samples[index - 1]!, end: samples[index]!, ribbon };
    const a = section.start.point, b = section.end.point;
    // Bucket reach covers the widest (stone) ribbon.
    const reach = ROAD_STONE_WIDTH;
    for (let z = Math.floor(Math.min(a.z, b.z) - reach); z <= Math.floor(Math.max(a.z, b.z) + reach); z++)
      for (let x = Math.floor(Math.min(a.x, b.x) - reach); x <= Math.floor(Math.max(a.x, b.x) + reach); x++) {
        const key = `${x}:${z}`, entries = buckets.get(key) ?? [];
        entries.push(section);
        buckets.set(key, entries);
      }
  }
  const distanceTo = (section: Section, x: number, z: number) => {
    const { end, start } = section, dx = end.point.x - start.point.x, dz = end.point.z - start.point.z;
    const squared = dx * dx + dz * dz;
    const projection = squared ? ((x - start.point.x) * dx + (z - start.point.z) * dz) / squared : 0;
    const t = Math.max(0, Math.min(1, projection));
    const width = (start.width ?? ROAD_WIDTH) * (1 - t) + (end.width ?? ROAD_WIDTH) * t;
    const centreX = start.point.x + dx * t, centreZ = start.point.z + dz * t;
    return { normalized: Math.hypot(x - centreX, z - centreZ) / (width * .5), centreX, centreZ, width, projection };
  };
  const isEdgeCovered = (x: number, z: number, ribbon: Sample[]) => {
    const owner = ribbonIds.get(ribbon);
    return (buckets.get(`${Math.floor(x)}:${Math.floor(z)}`) ?? []).some(other =>
      other.ribbon !== owner && distanceTo(other, x, z).normalized < .985);
  };
  const profile = (x: number, z: number) => {
    let nearest = 1, owner: Section | undefined, closest: ReturnType<typeof distanceTo> | undefined;
    for (const section of buckets.get(`${Math.floor(x)}:${Math.floor(z)}`) ?? []) {
      const sample = distanceTo(section, x, z);
      if (sample.normalized < nearest) { nearest = sample.normalized; owner = section; closest = sample; }
    }
    const crown = .028 * (1 - nearest ** 4);
    const track = .003 * Math.exp(-(((nearest - .55) / .16) ** 2));
    let shoulder = 0;
    if (owner && closest && nearest > .65 && closest.projection >= 0 && closest.projection <= 1) {
      // Test the nominal OUTER edge, rather than the inner shoulder point. Another road
      // covering that edge makes this an interior seam, even when its centre is farther away.
      const edgeX = closest.centreX + (x - closest.centreX) / nearest;
      const edgeZ = closest.centreZ + (z - closest.centreZ) / nearest;
      const covered = isEdgeCovered(edgeX, edgeZ, ribbons[owner.ribbon]!);
      if (!covered) {
        const band = Math.max(0, 1 - Math.abs(nearest - .84) / .16);
        shoulder = .013 * band * band;
      }
    }
    return Math.max(0, crown - track) + shoulder;
  };
  return Object.assign(profile, { isEdgeCovered });
};
