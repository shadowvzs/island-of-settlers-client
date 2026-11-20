import { Box3, Matrix4, Quaternion, Vector3 } from "three";

import type { WisteriaFlowerInstance, WisteriaLeafInstance } from "./wisteria-hero-graph";

export interface WisteriaLodAtlasMetadata {
  version: 2;
  racemeSpan: number;
  spraySpan: number;
  raceme: { min: readonly number[]; max: readonly number[] };
  spray: { min: readonly number[]; max: readonly number[] };
  coverage: Record<"racemeFront" | "racemeSide" | "fixedFront" | "fixedSide" | "sprayFront" | "spraySide", number>;
}

export const groupWisteriaBotany = <T extends WisteriaFlowerInstance | WisteriaLeafInstance>(
  instances: readonly T[], kind: "cluster" | "spray"
) => {
  const groups = new Map<number, T[]>();
  for (const instance of instances) {
    const key = (instance as WisteriaFlowerInstance & WisteriaLeafInstance)[kind];
    if (key === undefined || !Number.isSafeInteger(key)) throw new Error(`Wisteria Minimal requires canonical ${kind} identities`);
    const group = groups.get(key) ?? [];
    group.push(instance); groups.set(key, group);
  }
  return [...groups.values()];
};

/** Compound-leaf rachis frame shared by the bake and every Minimal instance. */
export const wisteriaSprayFrame = (leaves: readonly WisteriaLeafInstance[]) => {
  if (leaves.length < 3) throw new Error("A compound Wisteria leaf requires paired and terminal leaflets");
  const first = new Vector3(...leaves[0]!.position).add(new Vector3(...leaves[1]!.position)).multiplyScalar(.5);
  const end = new Vector3(...leaves.at(-1)!.position), forward = end.clone().sub(first);
  const origin = leaves[0]!.sprayOrigin ? new Vector3(...leaves[0]!.sprayOrigin) :
    first.clone().addScaledVector(forward, -1 / 9);
  forward.copy(end).sub(origin).normalize();
  const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
  if (right.lengthSq() < .0001) right.set(1, 0, 0);
  const normal = new Vector3().crossVectors(right, forward).normalize();
  return new Matrix4().makeBasis(right, forward, normal).setPosition(origin);
};

export const wisteriaAtlasBounds = (value: WisteriaLodAtlasMetadata["raceme"]) => {
  if (value.min.length !== 3 || value.max.length !== 3 ||
    ![...value.min, ...value.max].every(Number.isFinite)) throw new Error("Invalid Wisteria LOD atlas bounds");
  const box = new Box3(new Vector3().fromArray(value.min), new Vector3().fromArray(value.max));
  if (box.isEmpty()) throw new Error("Empty Wisteria LOD atlas bounds");
  return box;
};

/** Exact instance transform shared by the renderer and immutable physical clearance. */
export const wisteriaRacemeTransform = (cluster: readonly WisteriaFlowerInstance[], metadata: WisteriaLodAtlasMetadata) => {
  const first = cluster[0]!, last = cluster.at(-1)!;
  if (!first.clusterOrigin) throw new Error("Wisteria Minimal requires the canonical raceme origin");
  const ratio = (first.position[1] - last.position[1]) / metadata.racemeSpan;
  const bounds = wisteriaAtlasBounds(metadata.raceme), size = bounds.getSize(new Vector3());
  const centre = bounds.getCenter(new Vector3()); centre.y *= ratio;
  centre.applyAxisAngle(new Vector3(0, 1, 0), first.yaw).add(new Vector3(...first.clusterOrigin));
  return new Matrix4().compose(centre, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), first.yaw),
    new Vector3(size.x, size.y * ratio, size.z));
};

export const wisteriaSprayTransform = (spray: readonly WisteriaLeafInstance[], metadata: WisteriaLodAtlasMetadata) => {
  const first = new Vector3(...spray[0]!.position).add(new Vector3(...spray[1]!.position)).multiplyScalar(.5);
  const ratio = first.distanceTo(new Vector3(...spray.at(-1)!.position)) / metadata.spraySpan;
  const bounds = wisteriaAtlasBounds(metadata.spray), size = bounds.getSize(new Vector3());
  const centre = bounds.getCenter(new Vector3());
  return wisteriaSprayFrame(spray).multiply(new Matrix4().makeTranslation(centre.x, centre.y * ratio, centre.z))
    .multiply(new Matrix4().makeScale(size.x, size.y * ratio, size.z));
};
