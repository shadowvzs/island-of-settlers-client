import type { IUniform } from "three";

import { acquireClimberFoliageAtlas } from "./climber-foliage-atlas";
import { createDecorationFoliageMaterial, type DecorationFoliageMaterials } from "./decoration-foliage-material";
import type { FoliageAtlasLease } from "./foliage-atlas-loader";

export interface DecorationFoliageSource {
  /** The layer's shared leaf/petal materials; the first call leases the atlas, a failure retries later. */
  acquire(): Promise<DecorationFoliageMaterials>;
  dispose(): void;
  /** The layer's shared renderer uniforms (sun, wind, time); island-free scenes have none. */
  uniforms?: Record<string, IUniform>;
}

export interface DecorationFoliageSourceOptions {
  antialias: boolean;
  detailed: boolean;
  skyLit?: boolean;
  uniforms?: Record<string, IUniform>;
}

type AcquireAtlas = (detailed: boolean) => Promise<FoliageAtlasLease>;

/**
 * One atlas lease and one material pair per decoration layer: every climber template of that
 * detail level borrows them, so roses and ivy share textures, program and material state.
 */
export const createDecorationFoliageSource = (options: DecorationFoliageSourceOptions,
  acquireAtlas: AcquireAtlas = acquireClimberFoliageAtlas): DecorationFoliageSource => {
  let pending: Promise<DecorationFoliageMaterials> | undefined;
  let lease: FoliageAtlasLease | undefined, materials: DecorationFoliageMaterials | undefined;
  let disposed = false;
  const create = async () => {
    const next = await acquireAtlas(options.detailed);
    if (disposed) {
      next.release();
      throw new Error("Decoration foliage source was disposed while loading");
    }
    lease = next;
    materials = createDecorationFoliageMaterial({ ...options, maps: next.maps, tiles: next.tiles });
    return materials;
  };
  const acquire = () => {
    if (disposed) return Promise.reject(new Error("Decoration foliage source is disposed"));
    if (pending) return pending;
    const attempt = create();
    pending = attempt;
    attempt.catch(() => { if (pending === attempt && !materials) pending = undefined; });
    return attempt;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    materials?.dispose();
    lease?.release();
    materials = undefined; lease = undefined; pending = undefined;
  };
  return { acquire, dispose, uniforms: options.uniforms };
};
