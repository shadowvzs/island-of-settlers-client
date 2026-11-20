import { expect, it } from "vitest";

import { createCameraBookmarks, validCameraBookmarks } from "../src/app/camera-bookmarks";
import { createCamera } from "../src/render-common/camera-state";

it("persists detached island views and restores only camera pose, preserving viewport size", () => {
  const camera = createCamera(20, 30, 2),
    store = createCameraBookmarks();
  camera.yaw = 1;
  expect(store.add("Coast", camera, "cinematic")).toBe(true);
  camera.centerX = 1;
  const saved = store.list();
  saved[0]!.camera.centerX = 99;
  expect(store.list()[0]!.camera.centerX).toBe(20);
  const loaded = createCameraBookmarks(JSON.parse(JSON.stringify(store.list())));
  camera.viewportWidth = 500;
  expect(loaded.restore(0, camera, [64, 64])).toBe("cinematic");
  expect(camera.centerX).toBe(20);
  expect(camera.viewportWidth).toBe(500);
  expect(createCameraBookmarks().list()).toEqual([]);
});

it("bounds names/count, rejects corrupt saves and clamps restored views to the current map", () => {
  const camera = createCamera(300, -2, 99),
    store = createCameraBookmarks();
  expect(store.add(" ", camera, "iso")).toBe(false);
  for (let i = 0; i < 8; i++) expect(store.add("a".repeat(50), camera, "iso")).toBe(true);
  expect(store.list()[0]!.name.length).toBe(40);
  expect(store.add("ninth", camera, "iso")).toBe(false);
  store.restore(0, camera, [64, 64]);
  expect(camera.centerX).toBe(64);
  expect(camera.centerZ).toBe(0);
  expect(camera.zoom).toBe(3);
  expect(validCameraBookmarks([...store.list(), store.list()[0]])).toBe(false);
  const corrupt = store.list();
  corrupt[0]!.camera.yaw = NaN;
  expect(validCameraBookmarks(corrupt)).toBe(false);
  expect(createCameraBookmarks(corrupt).list()).toEqual([]);
  expect(store.restore(99, camera, [64, 64])).toBeNull();
  store.remove(0);
  expect(store.list().length).toBe(7);
});
