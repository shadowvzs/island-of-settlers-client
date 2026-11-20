import { Box3, BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBurnResources } from "../src/renderers/three/buildings/building-burn-effects";
import { createFortSiegeFires } from "../src/renderers/three/buildings/building-siege-fire";

/** The charred timber texture paints on a canvas; a minimal stand-in suffices outside the browser. */
beforeEach(() => {
  const context = { createImageData: (width: number, height: number) =>
    ({ data: new Uint8ClampedArray(width * height * 4) }), putImageData: () => undefined };
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => context }) });
});

afterEach(() => vi.unstubAllGlobals());

const fort = () => {
  const root = new Group(), geometry = new BoxGeometry(4, 3, 4), material = new MeshBasicMaterial();
  const body = new Mesh(geometry, material);
  body.position.y = 1.5; root.add(body); root.updateMatrixWorld(true);
  return { bounds: new Box3().setFromObject(root), root };
};
const meshes = (root: Group) => root.children.filter((child): child is InstancedMesh => child instanceof InstancedMesh);
const heightOf = (mesh: InstancedMesh, index: number) => {
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new Vector3().setFromMatrixPosition(matrix).y;
};

describe.each([true, false])("colony fort siege fire (high %s)", high => {
  it("lights one fire per milestone with rising smoke, then a ruin after the collapse", () => {
    const resources = createBurnResources(high), fires = createFortSiegeFires(high, resources);
    const { bounds, root } = fort();
    const effect = fires.create(bounds, "fort", root);
    const [fire, smoke, embers, ruins] = meshes(effect.root);
    effect.update({ flames: 2 }, 10);
    effect.update({ flames: 2 }, 12);
    expect(fire!.visible).toBe(true);
    expect(fire!.count).toBe(2 * (high ? 3 : 2));
    expect(smoke!.visible).toBe(true);
    expect(smoke!.count).toBe(2 * (high ? 4 : 3));
    expect(heightOf(smoke!, 0)).toBeGreaterThan(3);
    expect(embers!.visible).toBe(false);
    expect(ruins!.visible).toBe(false);
    effect.update({ fallenAge: 2, flames: 5 }, 13);
    expect(fire!.count).toBe(5 * (high ? 3 : 2));
    expect(embers!.visible).toBe(true);
    effect.update({ fallenAge: 8, flames: 5 }, 19);
    expect(fire!.visible).toBe(false);
    expect(ruins!.visible).toBe(true);
    expect(embers!.visible).toBe(high);
    effect.dispose(); fires.dispose(); resources.dispose();
  });
});
