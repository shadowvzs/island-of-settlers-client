import { expect, it } from "vitest";

import { createCommanderRenderPose } from "../src/app/commander-control/render-pose";

const mounted = { actor: 0, generation: 1, mounted: true, x: 10, y: .5, z: 20, yaw: 0 };
const rider = { actorId: 0, x: 9.98, y: .51, z: 19.97, heading: .02 };

it("follows the interpolated actual actor0 in the appropriate render layer", () => {
  const view = createCommanderRenderPose();
  expect(view.sample(mounted, { cavalryMounts: [rider] })).toMatchObject({
    actor: 0, x: rider.x, y: rider.y, z: rider.z, yaw: rider.heading });
  expect(view.sample(mounted)).toMatchObject({ x: rider.x, z: rider.z });
  const onFoot = { ...mounted, mounted: false, x: 10.7, yaw: 1 };
  const worker = { actorId: 0, x: 10.68, y: .49, z: 20, heading: .98 };
  expect(view.sample(onFoot, { workers: [worker], cavalryMounts: [rider] }))
    .toMatchObject({ mounted: false, x: worker.x, y: worker.y, yaw: worker.heading });
});

it("never keeps the previous mounted camera when the partial frame has no on-foot body", () => {
  const view = createCommanderRenderPose();
  view.sample(mounted, { cavalryMounts: [rider] });
  const onFoot = { ...mounted, mounted: false, x: 10.7, y: .4, yaw: -.7 };
  expect(view.sample(onFoot, { cavalryMounts: [] })).toBe(onFoot);
  expect(view.sample(onFoot)).toBe(onFoot);
  view.sample(onFoot, { workers: [{ ...rider, x: 10.69 }] });
  expect(view.sample(onFoot, { workers: [] })).toBe(onFoot);
});

it("discards presentation history on re-entry, actor switch and explicit lifecycle cleanup", () => {
  const view = createCommanderRenderPose();
  view.sample(mounted, { cavalryMounts: [rider] });
  const next = { ...mounted, generation: 2, x: 30 };
  expect(view.sample(next)).toBe(next);
  view.sample(next, { cavalryMounts: [rider] });
  const another = { ...next, actor: 4 };
  expect(view.sample(another)).toBe(another);
  view.sample(mounted, { cavalryMounts: [rider] }); view.clear();
  expect(view.sample(mounted)).toBe(mounted);
});
