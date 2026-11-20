import { float } from "three/tsl";
import { MeshStandardNodeMaterial, PhysicalLightingModel } from "three/webgpu";

type TslNode = any; // TSL's generated types do not model the proxied node methods.
type DirectLight = Parameters<PhysicalLightingModel["direct"]>[0] & { lightColor: TslNode };

/**
 * `connectSunShadowReceivers` (buildings/building-shadows.ts) on the node renderer: every direct
 * light's diffuse and specular are scaled by the sun shadow, as the WebGL hookup scales
 * `reflectedLight.directDiffuse/directSpecular`; the sky (indirect) light stays.
 */
class SunShadowedLightingModel extends PhysicalLightingModel {
  constructor(private readonly visibility: TslNode) {
    super();
  }

  override direct(light: DirectLight, builder?: unknown) {
    (super.direct as (input: DirectLight, builder?: unknown) => void)(
      { ...light, lightColor: light.lightColor.mul(this.visibility) }, builder);
  }
}

/** The standard stand-in of a WebGL sun shadow receiver (buildings, roads, monuments). */
export class SunShadowedStandardNodeMaterial extends MeshStandardNodeMaterial {
  /** `sampleSunShadow(positionWorld)` of the receiver (1 when the pass is off). */
  sunVisibility: TslNode = float(1);

  override setupLightingModel() {
    return new SunShadowedLightingModel(this.sunVisibility);
  }
}
