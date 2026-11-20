import { Bone, Group, Object3D, Vector3 } from "three";
import { expect, it } from "vitest";

import { CATAPULT_TRAVERSE } from "../src/render-common/buildings/catapult-mechanism";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import { createWorkerCatapultHands } from "../src/renderers/three/worker-catapult-hands";

it("keeps the near-extension native right palm on the release lever through its full press", () => {
  // Recorded native joint/socket positions from the real-time release-contact failure.
  const points = [
    [60.81726721185048, 5.690424301640823, 72.94872489451785],
    [60.804684847549034, 5.577618952800854, 73.07226877372831],
    [60.80268631002298, 5.480741954645202, 73.1817901830427],
    [60.82669998767897, 5.45881836284024, 73.22389324660438]
  ];
  for (const press of [.75, 1]) {
    const root = new Group(); let parent: Object3D = root;
    for (const [index, name] of ["RightArm", "RightForeArm", "RightHand", "socket_hand_R"].entries()) {
      const part = index === 3 ? new Object3D() : new Bone(); part.name = name;
      part.position.fromArray(points[index]!);
      if (index) part.position.sub(new Vector3().fromArray(points[index - 1]!));
      parent.add(part); parent = part;
    }
    const target = [60.83384448354697,
      1.0846143960952759 + (CATAPULT_TRAVERSE.trigger[1] - press * .04) * (16 / 11),
      73.22214480869778] as const;
    const contacts = createWorkerCatapultHands(root);
    contacts.apply({ catapultHands: [[0, 0, 0], target], catapultHandWeight: 1 } as unknown as WorkerFrame);
    expect(parent.getWorldPosition(new Vector3()).distanceTo(new Vector3(...target))).toBeLessThan(.005);
    contacts.reset();
  }
});
