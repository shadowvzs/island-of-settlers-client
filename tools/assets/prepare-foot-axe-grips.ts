import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AnimationMixer, Quaternion } from "three";

import { createMountedAxeGrip } from "../../src/renderers/three/mounted-axe-grip";
import { readCpuGltf } from "./read-cpu-gltf";

const profiles = [];
for (const variant of ["viking-woman-blue", "viking-woman-boots", "viking-woman-dark", "viking-man-blond", "viking-man-olive", "viking-man-red"]) {
  const folder = resolve(`../island-of-settlers-worker-generation/game_ready/tripo/${variant}`);
  const source = resolve(folder, "model.glb"), actions = resolve(folder, "actions.glb");
  const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const sourceSha256 = hash(source), actionsSha256 = hash(actions);
  const { scene } = await readCpuGltf(source), { animations } = await readCpuGltf(actions);
  const mixer = new AnimationMixer(scene); mixer.clipAction(animations.find(clip => clip.name === "idle_breathe")!).play(); mixer.setTime(.4);
  const hammer = animations.find(clip => clip.name === "build_hammer")!;
  for (const track of hammer.tracks) {
    if (!/^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)[123]\.quaternion$/.test(track.name)) continue;
    let key = 0; while (key + 1 < track.times.length && track.times[key + 1]! <= .65) key++;
    scene.getObjectByName(track.name.slice(0, -11))!.quaternion.copy(new Quaternion().fromArray(track.values, key * 4));
  }
  const started = performance.now(), grip = createMountedAxeGrip(scene, true);
  assert(grip.sockets.every(Boolean)); assert.equal(grip.fingers.length, 30);
  profiles.push({ variant, sourceSha256, actionsSha256, fitMilliseconds: performance.now() - started,
    sockets: grip.sockets.map(socket => ({ hand: socket!.parent!.name, name: socket!.name, position: socket!.position.toArray() })),
    fingers: grip.fingers.map(finger => ({ bone: finger.bone.name, quaternion: finger.grip.toArray() })) });
  assert.equal(hash(source), sourceSha256); assert.equal(hash(actions), actionsSha256);
}
writeFileSync(resolve("src/render-common/workers/viking-foot-axe-grips.json"), JSON.stringify({
  version: 1, provenance: "Original source skin and authored hammer seed; bounded offline finger/socket fit, no mesh/rig mutation.",
  profiles: profiles.map(({ fitMilliseconds: _, ...profile }) => profile)
}, null, 2) + "\n");
console.log(JSON.stringify(profiles.map(({ fitMilliseconds, variant }) => ({ variant, fitMilliseconds }))));
