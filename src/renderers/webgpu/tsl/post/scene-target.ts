import {
  DepthFormat,
  DepthTexture,
  FloatType,
  HalfFloatType,
  LinearFilter,
  RenderTarget
} from "three/webgpu";

/**
 * The single scene target of a WebGPU frame: half float colour plus a sampleable 32-bit depth
 * texture. Every world layer draws into it, then the post chain resolves exposure, bloom, ambient
 * occlusion and the colour output from it.
 *
 * No MSAA here: WebGPU cannot resolve a multisampled depth buffer, and the half-resolution GTAO
 * needs the depth as a sampled texture. The WebGL compositor can afford MSAA because WebGL2 blits
 * colour and depth together (frame-compositor.ts); the TSL chain trades that for working AO.
 */
export interface TslSceneTarget {
  depthTexture: DepthTexture;
  dispose: () => void;
  resize: (width: number, height: number) => void;
  target: RenderTarget;
}

export const createTslSceneTarget = (width: number, height: number): TslSceneTarget => {
  const sized = (nextWidth: number, nextHeight: number) => ({
    height: Math.max(1, nextHeight),
    width: Math.max(1, nextWidth)
  });
  const size = sized(width, height);
  const depthTexture = new DepthTexture(size.width, size.height, FloatType);
  depthTexture.format = DepthFormat;
  depthTexture.name = "tsl:scene-depth";
  const target = new RenderTarget(size.width, size.height, {
    depthBuffer: true,
    depthTexture,
    generateMipmaps: false,
    magFilter: LinearFilter,
    minFilter: LinearFilter,
    type: HalfFloatType
  });
  target.texture.name = "tsl:scene";
  return {
    depthTexture,
    dispose: () => {
      target.dispose();
      depthTexture.dispose();
    },
    resize: (nextWidth, nextHeight) => {
      const next = sized(nextWidth, nextHeight);
      if (next.width === target.width && next.height === target.height) return;
      target.setSize(next.width, next.height);
      depthTexture.image.width = next.width;
      depthTexture.image.height = next.height;
      depthTexture.needsUpdate = true;
    },
    target
  };
};
