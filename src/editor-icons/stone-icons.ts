import { ROCK_SEED } from "../app/asset-seeds";
import { ROCK_MESH_OPTIONS } from "../render-common/rocks/island-rocks";
import { createPropStones } from "../render-common/rocks/meadow-stones";
import { createOreStone } from "../render-common/rocks/mine-stones";
import type { RockInstance } from "../render-common/rocks/rock-instances";
import { buildRockMesh } from "../render-common/rocks/rock-mesh";
import { createRockLibrary } from "../render-common/rocks/rock-shapes";
import type { RockTerrain } from "../render-common/rocks/rock-terrain";
import { createRockTexture } from "../render-common/rocks/rock-texture";
import { createThreeRocks } from "../renderers/three/three-rocks";
import { createRandom } from "../shared/world/rng";
import { type IconStudio,STAGE_CENTRE } from "./icon-studio";

/** Flat, dry ground for the icon stones. */
const FLAT_GROUND: RockTerrain = {
  cellsX: STAGE_CENTRE * 2,
  cellsZ: STAGE_CENTRE * 2,
  height: () => 0,
  moisture: () => 0.3,
  mountain: () => 0,
  visibility: () => 1
};
/** A meadow stone's geology tint (rock tint -1 cool .. 1 warm). */
const MEADOW_TINT = 0.15;
const STONE_SEED = 11;
/** Placement scale of an icon stone and of an ore boulder's radius (world units). */
const STONE_SCALE = 1;
const ORE_RADIUS = 0.55;

/**
 * Stone icons with the game's rock layer (shapes, painted rock texture, rock shader): meadow
 * stones and pebbles as the editor places them, and ore boulders whose renders also serve as
 * the painted artwork on surveyed deposit signposts.
 */
export const createStoneIcons = (studio: IconStudio) => {
  const library = createRockLibrary();
  const texture = createRockTexture(ROCK_SEED);

  const shootRocks = (rocks: RockInstance[]) => {
    const data = buildRockMesh(rocks, library, FLAT_GROUND, ROCK_MESH_OPTIONS);
    const layer = createThreeRocks(
      { chunks: [{ chunk: 0, data, small: false }], count: rocks.length, pebbles: 0 },
      studio.uniforms,
      texture,
      true
    );
    return studio.shoot({ casters: [layer.casters], main: layer.group });
  };

  return {
    /** A meadow rock prop (small or large stone, pebbles). */
    renderStone: (kind: number) => {
      const place = { scale: STONE_SCALE, x: STAGE_CENTRE, yaw: 0.6, z: STAGE_CENTRE };
      const ground = {
        random: createRandom(STONE_SEED),
        terrain: FLAT_GROUND,
        tint: () => MEADOW_TINT
      };
      return shootRocks(createPropStones(kind, place, ground));
    },
    /** An ore boulder (ORE code). */
    renderOre: (ore: number) => {
      const request = {
        centre: [STAGE_CENTRE, STAGE_CENTRE] as [number, number],
        radius: ORE_RADIUS,
        yaw: 0.6
      };
      return shootRocks([createOreStone(FLAT_GROUND, createRandom(STONE_SEED), request, ore)]);
    }
  };
};
