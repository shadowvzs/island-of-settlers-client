import { createOwnedAssetCache, type OwnedAssetLease } from "./owned-asset-cache";

/**
 * The one shared horse model + coat mask of a mounted layer. Static/preview mounts hold a lease
 * for their whole life, an active or pending soldier mount holds one until it retires, and the
 * last lease disposes the template. The next mount that needs it loads it again.
 */
export const createHorseTemplateOwner = <T>(
  load: () => Promise<T>,
  dispose: (template: T) => void
) => {
  const templates = createOwnedAssetCache(() => load(), dispose);
  return {
    acquire: (): OwnedAssetLease<T> => templates.acquire("horse"),
    stats: templates.stats,
    dispose: templates.dispose
  };
};
