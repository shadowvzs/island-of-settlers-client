import {
  ClampToEdgeWrapping,
  ImageLoader,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  Texture
} from "three";

/**
 * NASA LROC equirectangular colour mosaic, 2048 x 1024, centred on longitude 0.
 * Provenance and credits are maintained with the exploration asset documentation.
 */
export const EXPLORATION_MOON_TEXTURE_URL = new URL(
  "../../../../assets/textures/exploration/moon-lroc-2k.jpg",
  import.meta.url
).href;

export type ExplorationMoonImageLoader = (url: string) => Promise<HTMLImageElement>;

export interface ExplorationMoonTextureOptions {
  loadImage?: ExplorationMoonImageLoader;
  onReady?: () => void;
}

export interface ExplorationMoonTextureStats {
  failed: boolean;
  live: number;
  loaded: boolean;
}

export interface ExplorationMoonTexture {
  dispose: () => void;
  imageReady: Promise<boolean>;
  stats: () => ExplorationMoonTextureStats;
  texture: Texture;
}

const loadWithImageLoader: ExplorationMoonImageLoader = (url) =>
  new Promise((resolve, reject) => {
    new ImageLoader().load(url, resolve, undefined, reject);
  });

const loadFunction = (
  loadImage: ExplorationMoonImageLoader | undefined
): ExplorationMoonImageLoader | null => {
  if (loadImage) return loadImage;
  return typeof document === "undefined" ? null : loadWithImageLoader;
};

/**
 * One local 2K moon albedo. The `Texture` object is allocated with the FPS sky, while the decoded
 * image is loaded asynchronously and dropped if the sky is disposed before it arrives.
 *
 * `NoColorSpace` is deliberate: this RawShaderMaterial writes display-space values straight to the
 * framebuffer without Three's output-colour-space transform. An sRGB upload would be linearised by
 * the sampler and then written without re-encoding, making the maria noticeably too dark.
 */
export const createExplorationMoonTexture = (
  options: ExplorationMoonTextureOptions = {}
): ExplorationMoonTexture => {
  let disposed = false;
  let failed = false;
  let loaded = false;
  const texture = new Texture();
  texture.colorSpace = NoColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.name = "exploration-moon-lroc-2k";
  texture.wrapS = RepeatWrapping;
  texture.wrapT = ClampToEdgeWrapping;

  const loadImage = loadFunction(options.loadImage);
  const imageRequest = loadImage
    ? (() => {
        try {
          return loadImage(EXPLORATION_MOON_TEXTURE_URL);
        } catch (error) {
          return Promise.reject(error);
        }
      })()
    : null;
  const imageReady = imageRequest
    ? imageRequest
      .then((image) => {
        if (disposed) return false;
        texture.image = image;
        texture.needsUpdate = true;
        loaded = true;
        options.onReady?.();
        return true;
      })
      .catch(() => {
        if (!disposed) failed = true;
        return false;
      })
    : Promise.resolve(false);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    texture.image = null;
    texture.dispose();
  };

  return {
    dispose,
    imageReady,
    stats: () => ({
      failed,
      live: disposed ? 0 : 1,
      loaded
    }),
    texture
  };
};
