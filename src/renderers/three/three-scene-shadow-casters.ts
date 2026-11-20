import type { Mesh, Object3D } from "three";

import { type CastSunShadows, createCasterRootScene, SHADOW_CASTER_LAYER } from "./three-shadows";

/** Puts a mesh flagged `castShadow` (the island's caster semantic) on the sun caster layer. */
const markCaster = (object: Object3D) => {
  if ((object as Mesh).isMesh && object.castShadow) object.layers.enable(SHADOW_CASTER_LAYER);
};

/**
 * Moving island-scene objects (ships, harbour shuttles, handcarts, transport horses) as sun shadow
 * casters (R02). Their meshes keep the main layer and gain the caster layer when flagged
 * `castShadow`; the visible subtrees are re-marked every pass because crafts, cargo and carts are
 * added at any time. Only these roots get fresh world matrices before the pass, and only they are
 * traversed (R08: drawing the whole island scene for them walked every island object).
 */
export const createSceneShadowCasters = (roots: readonly Object3D[]) => {
  const castRoots = createCasterRootScene();
  const casting: Object3D[] = [];
  return (cast: CastSunShadows) => {
    casting.length = 0;
    for (const root of roots) {
      if (!root.visible || !root.children.length) continue;
      root.traverseVisible(markCaster);
      root.updateMatrixWorld();
      casting.push(root);
    }
    castRoots(cast, casting);
  };
};
