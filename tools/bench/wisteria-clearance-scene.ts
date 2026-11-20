import { Box3, Color, PerspectiveCamera, WebGLRenderer } from "three";

import { computeEnvironment } from "../../src/render-common/environment";
import { CART_CARGO_LAYOUTS } from "../../src/render-common/logistics/cart-cargo-layouts";
import { CART_STONE_LANE, cartCapacityFor, HANDCART } from "../../src/render-common/logistics/handcart-rules";
import type { MountFrame } from "../../src/render-common/mounts/mount-frame";
import { NATION_RIDERS } from "../../src/render-common/mounts/nation-riders";
import type { WorkerNation } from "../../src/render-common/workers/worker-unit";
import { createRomanMaterials } from "../../src/renderers/three/buildings/roman-materials";
import { createRomanHandcart } from "../../src/renderers/three/settlement/roman-handcart";
import { createThreeMounts } from "../../src/renderers/three/three-mounts";
import { createWorkerTextureLoader } from "../../src/renderers/three/three-worker";
import { createWisteriaGeometryClearance, wisteriaActorBounds } from "../../src/renderers/three/wisteria-geometry-clearance";
import { createWisteriaHero } from "../../src/renderers/three/wisteria-hero";

const nations: readonly WorkerNation[] = ["roman", "viking", "nubian", "japanese", "chinese", "maya", "persian", "indigenous"];

/** Actual current skinned riders/standards and every legal authored cart cargo, not invented heights. */
export const measureWisteriaActorClearance = async () => {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1000, 900); document.body.append(renderer.domElement);
  const textures = createWorkerTextureLoader(renderer), base = createRomanMaterials(true);
  const arches = (["curved", "lattice", "pergola"] as const).map(frame => {
    const model = createWisteriaHero(base.materials, undefined, { frame });
    return { frame, model, collision: createWisteriaGeometryClearance(model.root) };
  });
  const arch = arches[0]!.model;
  const environment = computeEnvironment({ azimuthX: -.6, azimuthZ: .8, elevation: .85 }, 12, 0);
  const camera = new PerspectiveCamera(35, 1000 / 900, .01, 40);
  camera.position.set(3.5, 3.4, 5.5); camera.lookAt(0, 1.7, 0);
  const encode = (bounds: Box3) => ({ min: bounds.min.toArray(), max: bounds.max.toArray() });
  const sweep = (bounds: Box3, x: number, margin: number) => {
    const box = bounds.clone(); box.min.x += x; box.max.x += x;
    box.min.z = -2; box.max.z = 2;
    return arches.map(entry => ({ frame: entry.frame,
      clear: !entry.collision.intersects(box.clone().expandByScalar(margin)) }));
  };
  const mounted = [], carts = [], pictures: { name: string; image: string }[] = [];
  try {
    for (const detailed of [true, false]) {
      const mounts = await createThreeMounts(textures, [], detailed);
      mounts.scene.add(arch.root); mounts.scene.background = new Color("#bcc3b2");
      try {
        for (const [index, nation] of nations.entries()) {
          for (const pose of [{ clip: "idle" as const, time: .4 },
            ...[0, .25, .5, .75].map(time => ({ clip: "walk" as const, time }))]) {
            const frame: MountFrame = { actorId: index + 1, commander: true, auraActive: false,
              clip: pose.clip, clipTime: pose.time, coat: "bay", faction: 0, heading: 0, nation,
              rider: NATION_RIDERS[nation], turnRate: 0, x: 0, y: 0, z: 0 };
            await mounts.prepare([frame], environment);
            // Measure the actual mount layer before adding/showing the arch, excluding its non-solid aura.
            arch.root.visible = false;
            const bounds = wisteriaActorBounds(mounts.scene);
            arch.root.visible = true;
            const centerFrames = sweep(bounds, 0, .03);
            mounted.push({ quality: detailed ? "high" : "minimal", nation, pose,
              bounds: encode(bounds), frames: centerFrames,
              centerClear: centerFrames.every(entry => entry.clear),
              laneClear: [-CART_STONE_LANE, CART_STONE_LANE].every(x =>
                sweep(bounds, x, .03).every(entry => entry.clear)) });
            if (nation === "japanese" && pose.clip === "idle") {
              renderer.render(mounts.scene, camera);
              pictures.push({ name: `mounted-${detailed ? "high" : "minimal"}`,
                image: renderer.domElement.toDataURL("image/png").split(",")[1]! });
            }
          }
        }
      } finally { arch.root.removeFromParent(); mounts.dispose(); }
      const cart = createRomanHandcart(detailed);
      try {
        for (const ware of Object.keys(CART_CARGO_LAYOUTS)) {
          const capacity = cartCapacityFor(ware);
          if (!capacity) continue;
          cart.setLoad(Array.from({ length: capacity }, () => ware));
          const bounds = wisteriaActorBounds(cart.root);
          const frames = [-CART_STONE_LANE, CART_STONE_LANE].flatMap(x =>
            sweep(bounds, x, HANDCART.clearance).map(entry => ({ ...entry, lane: x })));
          carts.push({ quality: detailed ? "high" : "minimal", ware, capacity, bounds: encode(bounds),
            frames, lanesClear: frames.every(entry => entry.clear) });
        }
      } finally { cart.dispose(); }
    }
    return { mounted, carts, pictures, trianglesChecked: arches.map(entry => ({ frame: entry.frame, triangles: entry.collision.triangles })),
      scope: "Flat terrain; actual idle/walk skinned commander + standard bounds, conservative swept boxes across +/-2z. No attack/fall poses or unsupported terrain claim." };
  } finally {
    arches.forEach(entry => entry.model.dispose()); base.dispose(); textures.dispose(); renderer.dispose(); renderer.forceContextLoss();
  }
};
