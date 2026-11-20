import type { RoadSegment } from "../../../src/shared/settlement/road-types";
import { updateSettlementGroundClearance } from "../../../src/shared/settlement/settlement-ground-clearance";
import type { SettlementBuilding } from "../../../src/shared/settlement/settlement-types";
import { MAP_LAYERS } from "../../../src/shared/world/save/map-layers";
import type { WorldData } from "../../../src/shared/world/world-data";

/** Source state only: navigation, lighting, normals and fog legitimately rebuild at restore. */
const PRIMARY_LAYERS = new Set(["heights", "waterSurface", "waterDepth", "flow", "lakeWater",
  "splat", "themeWeights", "oreAmount", "mineZone", "clearedStoneGround"]);
export interface SemanticWorldFingerprint {
  schema: 1;
  sha256: string;
  sections: Array<{ name: string; bytes: number; sha256: string }>;
}
export interface SettlementGroundDefinition {
  buildings: readonly SettlementBuilding[];
  roads: readonly RoadSegment[];
}
const compareText = (left: string, right: string) => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(entry => canonical(entry));
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => compareText(left, right));
  return Object.fromEntries(entries.map(([key, entry]) => [key, canonical(entry)]));
};
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(canonical(value)));
const hexDigest = async (bytes: Uint8Array) => {
  const hash = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
};

/** Synchronously detach every section before hashing can yield to another application frame. */
export const captureSemanticWorld = (world: WorldData, ground?: SettlementGroundDefinition) => {
  const sections: Array<{ name: string; bytes: Uint8Array }> = [];
  let normalizedWorld = world;
  if (ground) {
    normalizedWorld = { ...world, clearedStoneGround: world.clearedStoneGround?.slice() };
    updateSettlementGroundClearance(normalizedWorld, ground.roads, ground.buildings);
  }
  for (const layer of MAP_LAYERS) {
    if (!PRIMARY_LAYERS.has(layer.name) && !layer.name.startsWith("props.")) continue;
    const array = layer.get(normalizedWorld);
    if (!array && !layer.optional) throw new Error(`Missing primary saved layer ${layer.name}`);
    let bytes: Uint8Array;
    if (array) bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength).slice();
    else {
      const count = layer.scope === "cell" ? world.cellsX * world.cellsZ :
        (world.cellsX + 1) * (world.cellsZ + 1);
      bytes = new Uint8Array(count * layer.stride);
    }
    sections.push({ name: layer.name, bytes });
  }
  const metadata = {
    seed: world.seed, cellsX: world.cellsX, cellsZ: world.cellsZ, seaLevel: world.seaLevel,
    start: { x: world.start.x, z: world.start.z }, sun: world.sun,
    mineZones: world.mineZones.map(({ surveyed: _surveyed, ...zone }) => zone),
    waterfalls: world.waterfalls, authoredRivers: world.authoredRivers ?? [],
    ...(world.restoreBaselineName ? { restoreBaselineName: world.restoreBaselineName } : {}),
    authoredTreeAges: world.authoredTreeAges ?? {}, scenario: world.scenario ?? null,
    ...(world.environmentDefaults ? { environmentDefaults: world.environmentDefaults } : {}),
    ...(world.generationProvenance ? { generationProvenance: world.generationProvenance } : {}),
    ...(world.colonyResourceTier ? { colonyResourceTier: world.colonyResourceTier } : {}),
    ...(world.colonyStoneDeposits ? { colonyStoneDeposits: world.colonyStoneDeposits } : {}),
    playableIslands: world.playableIslands ?? null, propCount: world.props.count
  };
  sections.push({ name: "metadata", bytes: encode(metadata) });
  return sections.sort((left, right) => compareText(left.name, right.name));
};

export const fingerprintSemanticSnapshot = async (
  snapshot: ReturnType<typeof captureSemanticWorld>
): Promise<SemanticWorldFingerprint> => {
  const sections = await Promise.all(snapshot.map(async section => ({
    name: section.name, bytes: section.bytes.byteLength, sha256: await hexDigest(section.bytes)
  })));
  return { schema: 1, sha256: await hexDigest(encode(sections)), sections };
};
export const fingerprintSemanticWorld = (world: WorldData, ground?: SettlementGroundDefinition) =>
  fingerprintSemanticSnapshot(captureSemanticWorld(world, ground));
