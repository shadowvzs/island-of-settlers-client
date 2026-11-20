import { OrthographicCamera, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";

import type { FrameState } from "../src/render-common/renderer-contract";
import { createRendererPicking } from "../src/renderers/three/three-renderer-picking";

const fixture = () => {
  const canvas = Object.assign(new EventTarget(), { style: {} }) as unknown as HTMLCanvasElement;
  const world = { cellsX: 64, cellsZ: 64, heights: new Float32Array(65 ** 2).fill(-4), seaLevel: 0 };
  const picking = createRendererPicking(canvas, world,
    { pickHit: () => null, setHover: () => false } as never,
    { pickHit: () => null, setHover: () => undefined } as never);
  return { picking, world };
};

describe("ship placement uses the visible sea plane", () => {
  it.each(["perspective", "orthographic"])("matches projection with the %s camera rather than seabed depth", kind => {
    const { picking, world } = fixture();
    const camera = kind === "perspective" ? new PerspectiveCamera(45, 1, .1, 200) :
      new OrthographicCamera(-24, 24, 24, -24, .1, 200);
    camera.position.set(32, 40, 48); camera.lookAt(32, 0, 32); camera.updateMatrixWorld();
    picking.setView(camera, { viewportWidth: 800, viewportHeight: 800 } as FrameState["camera"]);
    const screen = picking.projectToViewport(32, 0, 32);
    const water = picking.pickWater(screen.x, screen.y)!;
    expect(water.x).toBeCloseTo(32, 10);
    expect(water.y).toBe(0);
    expect(water.z).toBeCloseTo(32, 10);
    expect(picking.pickGround(screen.x, screen.y)!.z).not.toBeCloseTo(32);
    world.heights.fill(2);
    expect(picking.pickWater(screen.x, screen.y)).toBeNull();
    expect(picking.pickWater(-10000, -10000)).toBeNull();
    picking.dispose();
  });
});
