import type { SurfaceMode } from "../render-common/chunk-sampling";
import type { RockSkinDetail } from "../render-common/rocks/rock-skin";
import type { WorldData } from "../shared/world/world-data";

/**
 * Content revisions of one island world, split by what its worker builds read. Cache keys are
 * derived from these revisions, never from a save timestamp: a re-saved island whose terrain,
 * props, build state and fog are unchanged keeps its builds.
 */
export interface IslandBuildRevisions {
  /** Whole world content; the island cache group (bounded by the group eviction). */
  content: string;
  /** Terrain, water, materials and shading, before props, build state and fog are applied. */
  terrain: string;
  /** Static props: trees, bushes, stones and editor placements. */
  props: string;
  /** Build/resource layers that move stones or block navigation. */
  build: string;
  /** Fog of war shading; navigation does not read it. */
  fog: string;
}

/** Two independent 32-bit hashes: enough to keep unrelated islands apart without a crypto digest. */
class ContentHash {
  private first = 0x811c9dc5;
  private second = 0x9e3779b9;

  constructor(label: string) {
    this.text(label);
  }

  private byte(value: number) {
    this.first = Math.imul(this.first ^ value, 0x01000193) >>> 0;
    this.second = Math.imul(this.second ^ value, 0x85ebca6b) >>> 0;
    this.second = ((this.second << 13) | (this.second >>> 19)) >>> 0;
  }

  private uint32(value: number) {
    const number = value >>> 0;
    this.byte(number & 0xff);
    this.byte((number >>> 8) & 0xff);
    this.byte((number >>> 16) & 0xff);
    this.byte((number >>> 24) & 0xff);
  }

  text(value: string) {
    this.uint32(value.length);
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      this.byte(code & 0xff);
      this.byte(code >>> 8);
    }
  }

  number(value: number | undefined) {
    if (value === undefined) {
      this.byte(0);
      return;
    }
    this.byte(Number.isFinite(value) ? 1 : 2);
    this.text(String(value));
  }

  json(label: string, value: unknown) {
    this.text(label);
    this.text(value === undefined ? "" : JSON.stringify(value));
  }

  view(label: string, value: ArrayBufferView | undefined) {
    this.text(label);
    if (!value) {
      this.uint32(0xffffffff);
      return;
    }
    this.uint32(value.byteLength);
    const bytes = value instanceof Uint8Array
      ? value
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    for (let index = 0; index < bytes.length; index += 1) this.byte(bytes[index]!);
  }

  digest() {
    return `${this.first.toString(16).padStart(8, "0")}${this.second.toString(16).padStart(8, "0")}`;
  }
}

/** Fields that name the island itself, shared by every dependency revision. */
const addIdentity = (hash: ContentHash, world: WorldData) => {
  hash.number(world.seed);
  hash.number(world.cellsX);
  hash.number(world.cellsZ);
  hash.number(world.seaLevel);
  hash.number(world.start?.x);
  hash.number(world.start?.z);
};

const createTerrainRevision = (world: WorldData) => {
  const hash = new ContentHash("terrain-v2");
  addIdentity(hash, world);
  hash.json("sun", world.sun);
  for (const layer of [
    "heights", "normals", "waterSurface", "waterDepth", "flow", "coastDistance", "riverDistance",
    "splat", "themeWeights", "ambientOcclusion", "sunShadow", "heightLevels", "moisture", "wetRock",
    "lakeWater"
  ] as const) hash.view(layer, world[layer]);
  hash.json("waterfalls", world.waterfalls);
  return hash.digest();
};

const createPropsRevision = (world: WorldData) => {
  const hash = new ContentHash("props-v2");
  addIdentity(hash, world);
  const props = world.props;
  hash.number(props?.count ?? 0);
  if (props) {
    for (const layer of ["types", "form", "x", "y", "z", "rotation", "scale", "phase"] as const)
      hash.view(layer, props[layer].subarray(0, props.count));
  }
  hash.json("authoredTreeAges", world.authoredTreeAges);
  return hash.digest();
};

const createBuildRevision = (world: WorldData) => {
  const hash = new ContentHash("build-v2");
  addIdentity(hash, world);
  for (const layer of [
    "blocking", "buildCap", "buildClass", "slopeClass", "walkCost", "oreAmount", "mineZone",
    "roadGradeBase", "roadGradeApplied"
  ] as const) hash.view(layer, world[layer]);
  // The derived clearance is the same mask whether a live update or a map load provided it.
  hash.view("stone clearance", world.settlementGroundClearance ?? world.clearedStoneGround);
  hash.json("mineZones", world.mineZones);
  hash.json("colonyStoneDeposits", world.colonyStoneDeposits);
  hash.json("scenario", world.scenario);
  hash.number(world.colonyResourceTier);
  hash.text(world.expeditionKind ?? "");
  return hash.digest();
};

/**
 * Runtime revisions (`buildRevision`, `terrainRevision`, `fogRevision`) are deliberately absent:
 * they are not saved, so including them would make a captured island miss its own builds after
 * the reload. The layers they accompany are the persistent identity.
 */
const createFogRevision = (world: WorldData) => {
  const hash = new ContentHash("fog-v2");
  addIdentity(hash, world);
  hash.view("fog", world.fog);
  hash.number(world.fogDisplayDisabled ? 1 : 0);
  return hash.digest();
};

/** The dependency revisions of a world; pure and deterministic for the same content. */
export const islandBuildRevisions = (world: WorldData): IslandBuildRevisions => {
  const terrain = createTerrainRevision(world);
  const props = createPropsRevision(world);
  const build = createBuildRevision(world);
  const fog = createFogRevision(world);
  const content = new ContentHash("island-content-v2");
  addIdentity(content, world);
  content.json("generationProvenance", world.generationProvenance);
  content.text(terrain);
  content.text(props);
  content.text(build);
  content.text(fog);
  return { build, content: content.digest(), fog, props, terrain };
};

/**
 * The cache group of an island's builds: its content only, so a generated home and the same
 * home loaded from a game save share builds. The existing group eviction bounds old content.
 */
export const toIslandBuildGroup = (world: WorldData) => {
  const { content } = islandBuildRevisions(world);
  return JSON.stringify({ build: "content-v2", content });
};

/**
 * The island's worker build keys. Terrain chunks also read props (canopy shade and rock
 * contact), so every render build combines those revisions; navigation ignores fog, and the
 * water field does not need props or build state. Quality-specific inputs stay in the signatures
 * (surface mode, rock skin detail, grass samples).
 */
export const islandBuildKeys = (world: WorldData) => {
  const revisions = islandBuildRevisions(world);
  const rendered = `${revisions.terrain}:${revisions.props}:${revisions.build}:${revisions.fog}`;
  return {
    content: revisions.content,
    coverField: `cover field ${rendered}`,
    fieldCover: (samples: number) => `field cover ${samples} ${rendered}`,
    springFlowers: (samples: number) => `spring flowers ${samples} ${rendered}`,
    islandNav: `animal nav ${revisions.terrain}:${revisions.props}:${revisions.build}`,
    rockBodies: `rock bodies ${rendered}`,
    rockSkins: (detail: RockSkinDetail, part: number, parts: number) =>
      `rock skin ${detail} ${part} ${parts} ${rendered}`,
    terrainChunks: (mode: SurfaceMode, part: number, parts: number) =>
      `terrain ${mode} ${part} ${parts} ${rendered}`,
    waterField: `water field ${revisions.terrain}:${revisions.fog}`
  };
};

export type IslandBuildKeys = ReturnType<typeof islandBuildKeys>;
