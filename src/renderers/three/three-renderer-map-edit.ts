import type { DataTexture, IUniform } from "three";

import { createRendererMapEdit } from "../../render-common/map-edit/map-edit-builds";
import { patchCoverField } from "../../render-common/props/cover-field";
import type { RendererInput } from "../../render-common/renderer-contract";
import { getWinterTerrainChunk } from "../../render-common/seasonal-appearance/winter-terrain";
import type { WaterFieldPatch } from "../../render-common/water-field";
import type { ThreeGrassRing } from "./grass-ring/three-grass-ring";
import { type createThreeRocks, refreshMacroNormalTexture } from "./three-rocks";
import type { createThreeTerrain } from "./three-terrain";
import type { createThreeVegetation } from "./three-vegetation";
import { CULL_CHUNK_CELLS } from "./three-visibility";
import type { createThreeWaterWeeds } from "./three-water-weeds";

type MapEditInput = Pick<RendererInput, "quality" | "visualWinter" | "world"> & {
  /** T07: refills its ground samples (height, tint) after terrain edits. */
  grassRing: ThreeGrassRing | null;
  rocks: ReturnType<typeof createThreeRocks>;
  terrain: ReturnType<typeof createThreeTerrain>;
  uniforms: Record<string, IUniform>;
  vegetation: Awaited<ReturnType<typeof createThreeVegetation>>;
  weeds: ReturnType<typeof createThreeWaterWeeds>;
};

/** Copies only the patch's rows into the field and uploads those rows (one range per row). */
const updateWaterFieldPatch = (texture: DataTexture, patch: WaterFieldPatch) => {
  const image = texture.image as { data: Uint8Array; width: number };
  const rowLength = patch.width * 4;
  for (let row = 0; row < patch.height; row += 1) {
    const source = row * rowLength;
    const target = ((patch.y + row) * image.width + patch.x) * 4;
    image.data.set(patch.pixels.subarray(source, source + rowLength), target);
    texture.addUpdateRange(target, rowLength);
  }
  texture.needsUpdate = true;
};

/** Map editor hooks of the Three.js layers: each edit rebuilds only the meshes it touched. */
export const createThreeMapEdit = ({
  grassRing, quality, rocks, terrain, uniforms, vegetation, visualWinter = false, weeds, world
}: MapEditInput) =>
  createRendererMapEdit(world, ["terrain", "water"], {
    fieldCover: quality.grass
      ? { chunkCells: CULL_CHUNK_CELLS, replace: vegetation.replaceGrass, samplesPerCell: quality.grassSamples }
      : null,
    hideProps: vegetation.hideProps,
    patchCoverField: cells => {
      const texture = uniforms.uCoverField!.value as DataTexture;
      const image = texture.image as { data: Uint8Array; height: number; width: number };
      patchCoverField({ height: image.height, pixels: image.data, width: image.width }, world, cells);
      texture.needsUpdate = true;
      // Roads, crops and plots change the roadside keep in the ring's ground samples too.
      grassRing?.invalidate();
    },
    refreshPropGround: chunks => {
      vegetation.refreshPropGround(chunks);
      grassRing?.invalidate();
    },
    replaceRockChunks: (ids, meshes) => {
      rocks.replaceRockChunks(ids, meshes);
      refreshMacroNormalTexture(uniforms.uMacroNormals!.value as DataTexture, world);
    },
    growStones: rocks.growStones,
    replaceStones: rocks.replaceStones,
    setChunkGround: data => terrain.setChunkGround(visualWinter ? getWinterTerrainChunk(data) : data),
    setTerrainChunk: chunk => {
      grassRing?.invalidate();
      if (!visualWinter || chunk.mode !== "terrain" || !chunk.data) {
        terrain.setTerrainChunk(chunk);
        return;
      }
      terrain.setTerrainChunk({ ...chunk, data: getWinterTerrainChunk(chunk.data) });
    },
    replaceWaterWeeds: weeds.replaceWeeds,
    setWaterWeeds: weeds.setWeeds,
    setWaterField: (next) => {
      const texture = uniforms.uWaterField!.value as DataTexture;
      if ("x" in next) {
        updateWaterFieldPatch(texture, next);
        return;
      }
      (texture.image.data as Uint8Array).set(next.pixels);
      texture.clearUpdateRanges();
      texture.needsUpdate = true;
    },
    setWaterFieldPatch: (patch: WaterFieldPatch) => {
      updateWaterFieldPatch(uniforms.uWaterField!.value as DataTexture, patch);
    },
    setPlacedProps: vegetation.setPlacedProps
  });
