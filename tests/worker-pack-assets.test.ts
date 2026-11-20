import { AnimationClip, BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from "three";
import { expect, it, vi } from "vitest";

import { createWorkerPackAssets } from "../src/renderers/three/worker-pack-assets";

const bodyRoot = (texture: Texture) => {
  const root = new Group();
  root.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map: texture })));
  return root;
};

it("keeps a prop's shared texture after its body type is released", () => {
  const texture = new Texture(), textureDispose = vi.spyOn(texture, "dispose");
  const clip = new AnimationClip("idle_breathe", 1, []);
  const clipPath = "actions.glb";
  const clips = new Map([[clipPath, Promise.resolve([clip])]]);
  const textures = new Map([["shared", texture]]);
  const assets = createWorkerPackAssets({ clips, textures } as never);

  const done = assets.beginLoad();
  const body = {
    clips: [clip],
    entry: { animationOverrides: null, animations: clipPath },
    root: bodyRoot(texture)
  };
  assets.retainBody(body as never);
  done();
  const releaseProp = assets.retainProp(bodyRoot(texture));

  assets.releaseBody(body as never);
  expect(textureDispose).not.toHaveBeenCalled();
  expect(clips.has(clipPath)).toBe(false);

  releaseProp();
  expect(textureDispose).toHaveBeenCalledOnce();
  expect(textures.size).toBe(0);
  expect(assets.stats()).toEqual({ clips: 0, holders: 0, pending: 0, textures: 0 });
});

it("keeps a pending load's entries and trims them when it fails", () => {
  const texture = new Texture(), textureDispose = vi.spyOn(texture, "dispose");
  const clips = new Map([["actions.glb", Promise.resolve([new AnimationClip("idle", 1, [])])]]);
  const textures = new Map([["shared", texture]]);
  const assets = createWorkerPackAssets({ clips, textures } as never);

  const pending = assets.beginLoad();
  expect(assets.stats()).toMatchObject({ pending: 1 });
  expect(clips.size).toBe(1);
  expect(textures.size).toBe(1);
  // The failed load added cache entries without returning a body: end of load trims them.
  pending();
  expect(textureDispose).toHaveBeenCalledOnce();
  expect(clips.size).toBe(0);
  expect(textures.size).toBe(0);
  expect(assets.stats()).toEqual({ clips: 0, holders: 0, pending: 0, textures: 0 });
});

it("releases a late body's entries after the crowd was disposed", () => {
  const texture = new Texture(), textureDispose = vi.spyOn(texture, "dispose");
  const clip = new AnimationClip("idle_breathe", 1, []);
  const clipPath = "actions.glb";
  const clips = new Map([[clipPath, Promise.resolve([clip])]]);
  const textures = new Map([["shared", texture]]);
  const assets = createWorkerPackAssets({ clips, textures } as never);

  assets.dispose();
  const lateBody = {
    clips: [clip],
    entry: { animationOverrides: null, animations: clipPath },
    root: bodyRoot(texture)
  };
  assets.retainBody(lateBody as never);
  expect(textureDispose).toHaveBeenCalledOnce();
  expect(clips.has(clipPath)).toBe(false);
  expect(textures.size).toBe(0);
});
