import { type CameraState, createCamera } from "../../src/render-common/camera-state";
import { huntingWorld } from "../../tests/helpers/hunting-world";
import { runHunt } from "../../tests/helpers/wildlife-hunt-run";
import { liveCamera, wholeMapCamera } from "./wildlife-measure-helpers";

/**
 * Does where the camera looks change hunting outcomes? One hunter, a fixed herd, the real animal
 * manager stepped on the settlement tick; only the camera differs between runs (it must not matter).
 * Usage: npx tsx tools/analysis/wildlife-hunt-outcomes.ts [minutes=20]
 */
const MINUTES = Number(process.argv[2] ?? 20);

const views: Record<string, CameraState> = {
  headless: createCamera(10, 10, .2),
  nearHunter: liveCamera(30, 32, 1),
  farCorner: liveCamera(2, 62, 3),
  wholeMap: wholeMapCamera(huntingWorld())
};
for (const [name, camera] of Object.entries(views)) console.log(name.padEnd(11), JSON.stringify(runHunt(camera, MINUTES)));
console.log("repeat headless", JSON.stringify(runHunt(views.headless!, MINUTES)));
