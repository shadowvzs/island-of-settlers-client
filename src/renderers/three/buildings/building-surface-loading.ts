import type { SharedContentBuilders } from "../../../render-common/content-builders";
import type { RendererPrefetch } from "../../../render-common/renderer-contract";
import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { listBuildingSurfacePaints, listWareSurfacePaints, surfacePaintKey } from "./building-surface-paint";
import type { PaintedSurfaces } from "./building-surface-textures";

/**
 * Every surface map set of the nation's buildings and of the ware pack (carried goods, cart
 * cargo), painted by the world workers (or read from the island cache) instead of on the page
 * during the first frame. No nation: no buildings, only the wares.
 */
export const loadPaintedSurfaces = async (
  builders: SharedContentBuilders,
  nation: WorkerNation | undefined,
  detailed: boolean
): Promise<PaintedSurfaces> => {
  const buildings = nation ? listBuildingSurfacePaints(nation, detailed) : [];
  const paints = [...buildings, ...listWareSurfacePaints(detailed)];
  const maps = await Promise.all(paints.map((paint) => builders.paintBuildingSurface(paint)));
  return new Map(paints.map((paint, index) => [surfacePaintKey(paint), maps[index]!]));
};

/** Starts the painting while the island is generated (the builders run each surface once). */
export const prefetchBuildingSurfaces = ({ builders, buildingNation, quality }: RendererPrefetch) => {
  void loadPaintedSurfaces(builders, buildingNation, !quality.liteGround);
};
