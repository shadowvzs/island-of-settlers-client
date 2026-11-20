/**
 * G-W5 proactive compile. `WebGPURenderer` builds node state per `InstancedMesh` object (its uuid is
 * part of the cache key), so a variant batch created after loading, or re-created to grow, costs a
 * compile on its first draw. With this hint on (only while the WebGPU presenter runs) the GPU crowd
 * creates each baked body type's batch ahead of its first member, hidden while empty, so the loading
 * prewarm or the async compiler handles it before it is needed, and growable batches start larger.
 * The WebGL2 path leaves it off and keeps its lazy batches. No `three/webgpu` import here.
 */
let eager = false;

export const setEagerVariantBatches = (next: boolean) => {
  eager = next;
};

export const eagerVariantBatches = () => eager;

/** A growable batch's first capacity: larger while the hint is on, so growth (a new mesh) is rare. */
export const variantBatchCapacity = (lazyCapacity: number) => (eager ? lazyCapacity * 4 : lazyCapacity);
