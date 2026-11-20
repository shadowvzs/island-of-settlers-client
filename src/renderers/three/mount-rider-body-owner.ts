import { createOwnedAssetCache } from "./owned-asset-cache";

/** Rank-specific far bodies still share the identical full source geometry by URL. */
export const createRiderBodyOwner = <T>(load: (url: string) => Promise<T>, dispose: (body: T) => void, detailed: boolean) => {
  const models = createOwnedAssetCache(load, dispose);
  return {
    load: async (url: string, minimalUrl: string) => {
      const near = models.acquire(detailed ? url : minimalUrl);
      const far = detailed ? models.acquire(minimalUrl) : undefined;
      let released = false;
      const release = () => {
        if (released) return;
        released = true; near.release(); far?.release();
      };
      try {
        const [model, farModel] = await Promise.all([near.promise, far?.promise]);
        return { model, far: farModel, release };
      } catch (error) { release(); throw error; }
    },
    dispose: models.dispose
  };
};
