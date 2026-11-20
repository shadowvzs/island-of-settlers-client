import {
  Group, Mesh, MeshStandardMaterial, type Object3D,
SphereGeometry, Vector3} from "three";

import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { smoothstep01 } from "../../shared/world/noise";

/** The original thread is 1.3 mm thick; widen it so it reads at gameplay zoom (~1 px at 1.4). */
export const FISHING_LINE_WIDTH_SCALE = 8;
/** A slack line hangs by this share of its span in the middle. */
const FISHING_LINE_SAG = .05;
const FISHING_LINE_COLOR = "#f1ead6";
/** Bobber radius in the rod's model units (about .03 cells on the scaled worker). */
const BOBBER_RADIUS = .032;
export const BOBBER_NAME = "fishing_bobber";
const REEL_SECONDS = 4, CAST_SECONDS = 2.4;

/** A small two-tone float on the water; shared by the High and Minimal rods (64 or 24 triangles). */
export const addFishingBobber = (prop: Object3D, detailed: boolean) => {
  if (prop.getObjectByName(BOBBER_NAME)) return;
  const segments = detailed ? 8 : 4;
  const bobber = new Group();
  bobber.name = BOBBER_NAME;
  const half = (color: string, top: boolean) => new Mesh(
    new SphereGeometry(BOBBER_RADIUS, segments, segments / 2, 0, Math.PI * 2,
      top ? 0 : Math.PI / 2, Math.PI / 2),
    new MeshStandardMaterial({ color, roughness: .55 }));
  bobber.add(half("#c8382b", true), half("#f3eee2", false));
  bobber.visible = false;
  prop.add(bobber);
  prop.traverse(child => {
    if (!child.name.startsWith("fishing_line_") || !(child instanceof Mesh)) return;
    const material = child.material as MeshStandardMaterial;
    material.color.set(FISHING_LINE_COLOR);
  });
};

const UP = new Vector3(0, 1, 0);
/** Scratch vectors: the line is placed synchronously, one rod at a time. */
const water = new Vector3(), hand = new Vector3(), tip = new Vector3(), hook = new Vector3();
const lineStart = new Vector3(), lineEnd = new Vector3(), sagOffset = new Vector3();
const delta = new Vector3(), direction = new Vector3(), local = new Vector3();
/** Each rod's line segments in order (fishing_line_0, _1, ...), found once per rod. */
const rodLines = new WeakMap<Object3D, Object3D[]>();

/** Hook point of the cast (into `out`): flies out, floats with a gentle bob, then returns to the hand. */
const hookPoint = (frame: WorkerFrame, handPoint: Vector3, out: Vector3) => {
  const target = frame.fishingTarget!;
  out.set(target.x, target.y + .01, target.z);
  if (frame.action === "fish_cast") {
    const flight = smoothstep01((frame.animationTime / CAST_SECONDS - .48) / .28);
    out.copy(handPoint).lerp(water.set(target.x, target.y + .01, target.z), flight);
    out.y += .28 * Math.sin(flight * Math.PI);
    return out;
  }
  if (frame.action === "fish_reel")
    return out.lerp(handPoint, smoothstep01((frame.animationTime / REEL_SECONDS - .22) / .56));
  out.y += .008 * Math.sin(frame.animationTime * 2.6);
  return out;
};

/** Point `fraction` along the sagging line from the tip to the hook, in the line's local space. */
const linePoint = (lineRoot: Object3D, sag: number, fraction: number, out: Vector3) =>
  lineRoot.worldToLocal(out.copy(tip).lerp(hook, fraction)
    .add(sagOffset.set(0, -sag * Math.sin(Math.PI * fraction), 0)));

const placeLineSegments = (lines: Object3D[]) => {
  const lineRoot = lines[0]!.parent!;
  const sag = FISHING_LINE_SAG * tip.distanceTo(hook);
  for (let index = 0; index < lines.length; index++) {
    const a = linePoint(lineRoot, sag, index / lines.length, lineStart);
    const b = linePoint(lineRoot, sag, (index + 1) / lines.length, lineEnd);
    delta.copy(b).sub(a);
    const segment = lines[index]!;
    segment.position.copy(a).add(b).multiplyScalar(.5);
    segment.quaternion.setFromUnitVectors(UP, direction.copy(delta).normalize());
    segment.scale.set(FISHING_LINE_WIDTH_SCALE, delta.length(), FISHING_LINE_WIDTH_SCALE);
  }
};

const getRodLines = (prop: Object3D) => {
  let lines = rodLines.get(prop);
  if (lines) return lines;
  lines = [];
  prop.traverse(child => { if (child.name.startsWith("fishing_line_")) lines!.push(child); });
  lines.sort((a, b) => Number(a.name.split("_").at(-1)) - Number(b.name.split("_").at(-1)));
  rodLines.set(prop, lines);
  return lines;
};

/** Keep the original pole and its bending clip; arc its line from the tip to the float. */
export const placeFishingLine = (prop: Object3D, root: Object3D, frame: WorkerFrame) => {
  const bobber = prop.getObjectByName(BOBBER_NAME);
  if (bobber) bobber.visible = false;
  if (!frame.fishingTarget || !frame.action.startsWith("fish_")) return;
  const knot = prop.getObjectByName("pole_tip_knot"), catchFish = prop.getObjectByName("caught_fish");
  if (!knot || !catchFish) return;
  root.updateMatrixWorld(true);
  knot.getWorldPosition(tip);
  hookPoint(frame, root.localToWorld(hand.set(.13, .5, .27)), hook);
  const lines = getRodLines(prop);
  if (!lines.length) return;
  placeLineSegments(lines);
  catchFish.position.copy(catchFish.parent!.worldToLocal(local.copy(hook)));
  if (!bobber) return;
  const reeling = frame.action === "fish_reel" && frame.animationTime / REEL_SECONDS > .6;
  bobber.visible = !reeling;
  bobber.position.copy(bobber.parent!.worldToLocal(local.copy(hook)));
};
