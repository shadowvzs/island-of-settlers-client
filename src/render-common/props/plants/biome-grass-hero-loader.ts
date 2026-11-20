import heroUrl from "./biome-grass-hero-data.gz.bin?url";
import { installBiomeGrassHeroPayload, isBiomeGrassHeroPayloadInstalled } from "./biome-grass-mesh";
import { fetchBiomeGrassPayload } from "./biome-grass-mesh-loader";

let loading: Promise<void> | undefined;

/**
 * Close-up hero geometry for icon/preview tools only; the game's field cover never requests it,
 * so the hero payload stays out of the runtime chunk.
 */
export const loadBiomeGrassHeroPayload = () => {
  if (isBiomeGrassHeroPayloadInstalled()) return Promise.resolve();
  loading ??= fetchBiomeGrassPayload(heroUrl).then(installBiomeGrassHeroPayload).catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
};
