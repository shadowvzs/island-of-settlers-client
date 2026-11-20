import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import type { BuildingPart, BuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { addIndigenousFortressDeck } from "../src/render-common/buildings/indigenous-fortress-decks";
import { addIndigenousFramedBody } from "../src/render-common/buildings/indigenous-framed-body";
import { rotateByEuler } from "../src/render-common/buildings/recipe-rotation";
import { createIndigenousFrameSkin } from "../src/renderers/three/buildings/indigenous-frame-skin";

it("conceals the whole fortress frame below its actual rounded textile mesh in both detail levels", () => {
  const original: BuildingRecipe = { doorProfile: "flat", door: [-.23, 0, .796],
    doorDimensions: { height: .77, spring: .63, width: .46 }, parts: [],
    mechanism: [.9088, .47, 1.04], workPoint: [1.278, 0, 1.28], workerExit: [0, 0, 1.73] };
  for (const detailed of [true, false]) for (const size of [[.69, 2.055, .69], [1.10, 2.435, .81]] as const) {
    const parts: BuildingPart[] = [];
    addIndigenousFramedBody(part => parts.push({ stage: 1, ...part }), original, [0, 0, 0],
      [...size], detailed, [0, 0, -.5], false, { frameMargin: .12, radius: .20 });
    const deck: BuildingPart[] = [], corner = size[0] < .8;
    addIndigenousFortressDeck(part => deck.push({ stage: 1, ...part }), {
      base: 0, deck: size[1] + .025, depth: size[2] + (corner ? .07 : .04),
      kind: corner ? "corner" : "keep", width: size[0] + (corner ? .07 : .04), x: 0, z: 0, windows: []
    }, detailed);
    parts.push(...deck.filter(part => getRomanPartBounds(part).max[1] < size[1] - .005));
    const geometry = createIndigenousFrameSkin(detailed, undefined, undefined, .20);
    const material = new MeshBasicMaterial({ side: DoubleSide }), skin = new Mesh(geometry, material);
    skin.scale.set(size[0], size[1], size[2]); skin.position.y = size[1] / 2; skin.updateMatrixWorld(true);
    for (const part of parts.filter(part => part.shape === "box" && part.surface === "wood"))
      for (const sx of [-.5, 0, .5]) for (const sy of [-.5, 0, .5]) for (const sz of [-.5, 0, .5]) {
        const local = rotateByEuler([sx * part.size[0], sy * part.size[1], sz * part.size[2]],
          part.rotation ?? [0, 0, 0]);
        const point = new Vector3(...local).add(new Vector3(...part.position));
        point.y = Math.max(.001, Math.min(size[1] - .001, point.y));
        const direction = new Vector3(point.x, 0, point.z), distance = direction.length();
        if (distance < .001) continue;
        const ray = new Raycaster(new Vector3(0, point.y, 0), direction.normalize());
        const hit = ray.intersectObject(skin)[0];
        expect(hit, "Actual native cloth wall missing").toBeDefined();
        expect(hit!.distance - distance, `${detailed}/${size.join(",")}/${part.position.join(",")}`)
          .toBeGreaterThanOrEqual(.04);
      }
    geometry.dispose(); material.dispose();
  }
});
