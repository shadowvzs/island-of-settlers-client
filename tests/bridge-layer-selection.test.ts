import { type Group, type Mesh, MeshStandardMaterial, Raycaster, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { createThreeBridges } from "../src/renderers/three/settlement/three-bridges";
import type { BridgeConstructionSnapshot } from "../src/shared/settlement/bridge-construction";
import { bridgeDecks, deckPoint } from "../src/shared/settlement/bridge-deck";
import { planBridge } from "../src/shared/settlement/bridge-planning";
import { createBridgeSurfaceService } from "../src/shared/settlement/bridge-surface";
import type { RoadSegment } from "../src/shared/settlement/road-types";
import { angledBridgeTestWorld, bridgeRules } from "./helpers/bridge-world";

const material = new MeshStandardMaterial();
const materials = new Proxy({} as Record<BuildingSurface, MeshStandardMaterial>, { get: () => material });

const fixture = (kind: "stone" | "wood") => {
  const world = angledBridgeTestWorld({ angleDegrees: 50, centre: { x: 16, z: 16 }, halfWidth: 1.6 });
  const result = planBridge({ id: 7, kind, pointer: { x: 16, z: 16 }, rules: bridgeRules(world), world });
  if (!result.ok) throw new Error(result.reason);
  const surface = createBridgeSurfaceService(() => 0.3, () => 0.2);
  const layer = createThreeBridges({ detailed: true, materialsFor: () => materials, surface,
    terrainHeight: () => 0.3, waterHeight: () => 0.2 });
  const deck = bridgeDecks(result.plan.segments)[0]!;
  /** A ray straight down onto the deck half way across the river. */
  const downRay = () => {
    const middle = deckPoint(deck, deck.length / 2, 0.6);
    return new Raycaster(new Vector3(middle.x, 20, middle.z), new Vector3(0, -1, 0));
  };
  const withLevel = (level: number): RoadSegment[] => result.plan.segments.map(segment =>
    ({ ...segment, bridge: { ...segment.bridge!, ...(level ? { level: level as 1 } : {}) } }));
  return { deck, downRay, layer, plan: result.plan, surface, withLevel };
};

const named = (root: Group, name: string) => {
  const found: Mesh[] = [];
  root.traverse(child => { if (child.name === name) found.push(child as Mesh); });
  return found;
};

describe("bridge selection in the renderer", () => {
  for (const kind of ["wood", "stone"] as const)
    it(`picks a completed ${kind} bridge and outlines it on hover and while selected`, () => {
      const { downRay, layer, surface, withLevel } = fixture(kind);
      surface.update(withLevel(0));
      layer.update([]);
      layer.root.updateMatrixWorld(true);
      expect(layer.pickHit(downRay())?.id).toBe(7);
      expect(layer.setHover(7)).toBe(true);
      expect(named(layer.root, "bridge_hover_outline")).toHaveLength(1);
      layer.setSelected(7);
      layer.setHover(null);
      expect(named(layer.root, "bridge_hover_outline")).toHaveLength(1);
      layer.setSelected(null);
      expect(named(layer.root, "bridge_hover_outline")).toHaveLength(0);
      expect(layer.setHover(99)).toBe(false);
      layer.dispose();
    });

  it("rebuilds the model with more detail when the bridge level rises, keeping the selection", () => {
    const { layer, surface, withLevel } = fixture("stone");
    const triangles = () => named(layer.root, "bridge_model").flatMap(root => root.children as Mesh[])
      .reduce((sum, mesh) => sum + mesh.geometry.getAttribute("position").count / 3, 0);
    surface.update(withLevel(0));
    layer.update([]);
    layer.setSelected(7);
    const base = triangles();
    surface.update(withLevel(4));
    layer.update([]);
    expect(triangles()).toBeGreaterThan(base);
    expect(named(layer.root, "bridge_hover_outline")).toHaveLength(1);
    layer.dispose();
  });

  it("shows an upgrade site's stock beside the open bridge without a second model", () => {
    const { layer, plan, surface, withLevel } = fixture("wood");
    surface.update(withLevel(0));
    const site = { id: 7, kind: "wood", progress: 0.2, segments: withLevel(0), stockPoint: plan.approaches[0].outer,
      upgrade: { level: 1 } } as unknown as BridgeConstructionSnapshot;
    layer.update([site]);
    expect(named(layer.root, "bridge_model")).toHaveLength(1);
    const piles = named(layer.root, "bridge_stock_pile");
    expect(piles).toHaveLength(1);
    const pile = piles[0]!.position, outer = plan.approaches[0].outer;
    expect(Math.hypot(pile.x - outer.x, pile.z - outer.z)).toBeGreaterThan(1.2);
    layer.update([]);
    expect(named(layer.root, "bridge_stock_pile")).toHaveLength(0);
    layer.dispose();
  });

  it("picks a construction site by its staged model", () => {
    const { downRay, layer, surface, withLevel } = fixture("wood");
    surface.update([]);
    const site = { id: 7, kind: "wood", progress: 0.9, segments: withLevel(0),
      stockPoint: { x: 0, z: 0 } } as unknown as BridgeConstructionSnapshot;
    layer.update([site]);
    layer.root.updateMatrixWorld(true);
    expect(layer.pickHit(downRay())?.id).toBe(7);
    expect(layer.setHover(7)).toBe(true);
    layer.dispose();
  });
});
