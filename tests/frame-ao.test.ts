import { AlwaysStencilFunc, MeshBasicMaterial, type RenderItem, ReplaceStencilOp, type WebGLRenderer } from "three";
import { describe, expect, it } from "vitest";

import {
  type AmbientOcclusionLevelTuning,
  AO_LEVEL_TUNING,
  AO_TUNING
} from "../src/render-common/shaders/frame-ao-glsl";
import {
  AO_EXCLUDED_STENCIL_BIT,
  aoExcludedLastOpaqueSort,
  excludeFromAmbientOcclusion,
  renderAsAmbientOcclusionReceivers
} from "../src/renderers/three/ambient-occlusion-exclusion";
import { ambientOcclusionSize } from "../src/renderers/three/frame-ao";

describe("R12b ambient occlusion helpers", () => {
  it("marks an excluded material with the AO stencil bit only", () => {
    const material = excludeFromAmbientOcclusion(new MeshBasicMaterial());
    expect(material).toMatchObject({
      stencilFunc: AlwaysStencilFunc,
      stencilRef: AO_EXCLUDED_STENCIL_BIT,
      stencilWrite: true,
      stencilWriteMask: AO_EXCLUDED_STENCIL_BIT,
      stencilZPass: ReplaceStencilOp
    });
    expect(material.depthWrite).toBe(true);
    expect(material.colorWrite).toBe(true);
  });

  it("WALL-PATCHES: sorts AO-excluded materials after the other opaque surfaces of their render order", () => {
    const excluded = excludeFromAmbientOcclusion(new MeshBasicMaterial());
    const wall = new MeshBasicMaterial();
    const item = (material: MeshBasicMaterial, renderOrder = 0, z = 0) =>
      ({ groupOrder: 0, id: z, material, materialVariant: 0, renderOrder, z }) as unknown as RenderItem;
    const items = [item(excluded, 0, 1), item(wall, 0, 50), item(wall, 1, 2)];
    const sorted = items.sort(aoExcludedLastOpaqueSort);
    expect(sorted.map(entry => [entry.material === excluded, entry.renderOrder])).toEqual([
      [false, 0], [true, 0], [false, 1]
    ]);
  });

  it("WALL-PATCHES: later layers clear the AO stencil bit and release the stencil lock", () => {
    const calls: string[] = [];
    const stencil = {
      setFunc: (func: number, ref: number) => calls.push(`func ${func} ${ref}`),
      setLocked: (locked: boolean) => calls.push(`locked ${locked}`),
      setMask: (mask: number) => calls.push(`mask ${mask}`),
      setOp: (fail: number, zFail: number, zPass: number) => calls.push(`op ${fail} ${zFail} ${zPass}`),
      setTest: (test: boolean) => calls.push(`test ${test}`)
    };
    const gl = { ALWAYS: 519, KEEP: 7680, REPLACE: 7681 };
    const renderer = { getContext: () => gl, state: { buffers: { stencil } } } as unknown as WebGLRenderer;
    renderAsAmbientOcclusionReceivers(renderer, () => calls.push("draw"));
    expect(calls).toEqual([
      "test true", `mask ${AO_EXCLUDED_STENCIL_BIT}`, "func 519 0", "op 7680 7680 7681", "locked true", "draw",
      "locked false", "test false"
    ]);
  });

  it("rounds the half-resolution size up, so texel i always reads full pixel 2i", () => {
    expect(ambientOcclusionSize(1920, 1080)).toEqual([960, 540]);
    expect(ambientOcclusionSize(1601, 901)).toEqual([801, 451]);
    expect(ambientOcclusionSize(1, 1)).toEqual([1, 1]);
  });

  it("keeps every choice's strength and halo controls in range", () => {
    for (const level of Object.values(AO_LEVEL_TUNING)) {
      expect(level.strength).toBeGreaterThan(0);
      expect(level.strength).toBeLessThanOrEqual(1);
      expect(AO_TUNING.bias).toBeLessThan(level.radius);
    }
    expect(AO_TUNING.falloff).toBeGreaterThan(0);
    expect(AO_TUNING.falloff).toBeLessThanOrEqual(1);
  });

  it("makes Dramatic the Strong curve that also darkens sunlit surfaces", () => {
    const { dramatic, soft, strong } = AO_LEVEL_TUNING;
    expect(soft.sunlit).toBe(1);
    expect(strong.sunlit).toBe(1);
    expect(dramatic).toEqual({ ...strong, sunlit: 0 });
  });

  it("makes Strong clearly darker than Soft in creases while open ground stays clean", () => {
    /** The output pass: mix(1, pow(ao, power), strength). */
    const shade = ({ power, strength }: AmbientOcclusionLevelTuning, ao: number) =>
      1 - strength + strength * ao ** power;
    const { soft, strong } = AO_LEVEL_TUNING;
    expect(shade(strong, 0.7)).toBeLessThan(shade(soft, 0.7) - 0.1);
    expect(shade(strong, 0.5)).toBeLessThan(shade(soft, 0.5) - 0.1);
    expect(strong.radius).toBeGreaterThan(soft.radius);
    expect(shade(strong, 0.995)).toBeGreaterThan(0.98);
  });
});
