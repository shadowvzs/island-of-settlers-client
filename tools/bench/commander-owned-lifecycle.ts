import assert from "node:assert/strict";
import type { BrowserContext, Page } from "playwright-core";

/** Bench-only observations of actual ownership, without changing production release paths. */
export const installCommanderOwnedLifecycle = async (context: BrowserContext, page: Page) => {
  await context.addInitScript(() => {
    const host = window as any;
    host.__name = (value: unknown) => value;
    const records: Array<{ ref: WeakRef<any>; kind: string; live: boolean; imageBytes: number }> = [];
    const seen = new WeakSet<object>(), caches: Array<{ name: string; read: () => unknown }> = [];
    const requests = new Map<string, number>();
    const listeners = new Map<string, Set<unknown>>();
    const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
    const key = (target: EventTarget, type: string, options: any) => target === window || target === document
      ? `${target === window ? "window" : "document"}:${type}:${typeof options === "boolean" ? options : Boolean(options?.capture)}` : null;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      const id = key(this, type, options);
      if (id && listener) { const set = listeners.get(id) ?? new Set(); set.add(listener); listeners.set(id, set); }
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function(type, listener, options) {
      const id = key(this, type, options); if (id && listener) listeners.get(id)?.delete(listener);
      return remove.call(this, type, listener, options);
    };
    const bytes = (texture: any) => {
      const image = texture?.image;
      const images = Array.isArray(image) ? image : [image];
      return images.reduce((total: number, value: any) => total + (value?.data?.byteLength ??
        ((value?.naturalWidth ?? value?.width ?? 0) * (value?.naturalHeight ?? value?.height ?? 0) * 4)), 0) +
        (texture?.mipmaps ?? []).reduce((total: number, value: any) => total + (value?.data?.byteLength ?? 0), 0);
    };
    let pendingPreparation = 0, releaseGate: (() => void) | undefined;
    host.__commanderOwned = {
      holdPreparation: false,
      preparationHeld: false,
      own: (value: any, kind: string) => {
        if (!value || seen.has(value)) return;
        seen.add(value);
        const record = { ref: new WeakRef(value), kind, live: true, imageBytes: value.isTexture ? bytes(value) : 0 }; records.push(record);
        value.addEventListener("dispose", () => { record.live = false; });
      },
      cache: (name: string, read: () => unknown) => caches.push({ name, read }),
      awaiting: (promise: Promise<unknown>, name: string) => {
        requests.set(name, (requests.get(name) ?? 0) + 1);
        void promise.then(() => requests.set(name, Math.max(0, (requests.get(name) ?? 0) - 1)),
          () => requests.set(name, Math.max(0, (requests.get(name) ?? 0) - 1)));
      },
      prepare: async (run: () => Promise<void>) => {
        pendingPreparation++;
        try {
          await run();
          if (host.__commanderOwned.holdPreparation) {
            host.__commanderOwned.preparationHeld = true;
            await new Promise<void>(resolve => { releaseGate = resolve; });
            host.__commanderOwned.preparationHeld = false;
          }
        } finally { pendingPreparation--; }
      },
      releasePreparation: () => { host.__commanderOwned.holdPreparation = false; releaseGate?.(); releaseGate = undefined; },
      snapshot: () => {
        const live: Record<string, number> = {}, imageBytes: Record<string, number> = {};
        let orphanedUndisposed = 0;
        for (const record of records) {
          if (!record.live) continue;
          const value = record.ref.deref();
          if (!value) orphanedUndisposed++;
          live[record.kind] = (live[record.kind] ?? 0) + 1;
          if (value?.isTexture) record.imageBytes = bytes(value);
          if (record.imageBytes) imageBytes[record.kind] = (imageBytes[record.kind] ?? 0) + record.imageBytes;
        }
        return { live, imageBytes, caches: caches.map(({ name, read }) => ({ name, value: read() })),
          listeners: [...listeners.values()].reduce((sum, set) => sum + set.size, 0), pendingPreparation,
          pendingLoads: [...requests.values()].reduce((sum, count) => sum + count, 0), orphanedUndisposed };
      }
    };
  });
  const patches: Record<string, Array<[string | RegExp, string]>> = {
    "three-renderer-shading.ts": [
      // The disposal flag shares its declaration with the traffic-wear texture slot.
      [/let disposed = false(?=[,;])/, `for (const texture of textures) window.__commanderOwned.own(texture,"shading-texture");
        window.__commanderOwned.own(refraction,"refraction-target"); let disposed = false`],
      [/ownWaterField: \(texture\) => \{/, `ownWaterField: (texture) => { window.__commanderOwned.own(texture,"shading-texture");`]
    ],
    "three-shadows.ts": [[/return \{\s*dispose: \(\) => \{/, `window.__commanderOwned.own(target,"shadow-target");
      return { dispose: () => {`]],
    "worker-body-pool.ts": [
      [/let instances = 0;/, `let instances = 0; window.__commanderOwned.cache("body-pool",()=>({...bodies.stats(),instances}));`],
      [/shared.retainBody\(source\);/, `shared.retainBody(source); source.root.traverse(object=>{
        if(!object.material)return; for(const material of Array.isArray(object.material)?object.material:[object.material]) {
          window.__commanderOwned.own(material,"worker-source-material");
          for(const texture of Object.values(material)) if(texture?.isTexture) window.__commanderOwned.own(texture,"worker-pack-texture");
        }});`],
      [/const mixer = new AnimationMixer\(root\);/, `for(const material of materials.values()) window.__commanderOwned.own(material,"worker-instance-material");
        const mixer = new AnimationMixer(root);`]
    ],
    "worker-pack-assets.ts": [[/let disposed = false;/, `let disposed = false;
      window.__commanderOwned.cache("worker-pack",()=>({clips:clipCache?.size??0,holders:holders.size,pending,textures:textureCache?.size??0}));`]],
    "exploration-sky-object.ts": [
      [/scene.add\(mesh\);/, `scene.add(mesh); window.__commanderOwned.own(material,"sky-material"); window.__commanderOwned.own(geometry,"sky-geometry");`],
      [/cloudNoise = createExplorationSkyNoise\(\);/, `cloudNoise = createExplorationSkyNoise(); window.__commanderOwned.own(cloudNoise,"sky-texture");`]
    ],
    "exploration-moon-texture.ts": [
      [/const texture = new Texture\(\);/, `const texture = new Texture(); window.__commanderOwned.own(texture,"moon-texture");`],
      [/const dispose = \(\) => \{/, `window.__commanderOwned.awaiting(imageReady,"moon-image"); const dispose = () => {`]
    ],
    "exploration-sky-preparation.ts": [[/await sky.prepare\(renderer, camera\);/, `await window.__commanderOwned.prepare(()=>sky.prepare(renderer,camera));`]],
    "island-runtime.ts": [[/return \{\s*assets,\s*camera,\s*canvas,\s*dispose,\s*ready,\s*renderer,\s*renderLoop,\s*settlementSession,\s*world,/, `window.__commanderOwned.disposeRuntime=dispose;
      return { assets, camera, canvas, dispose, ready, renderer, renderLoop, settlementSession, world,`]]
  };
  for (const [file, replacements] of Object.entries(patches)) await page.route(`**/${file}*`, async route => {
    const response = await route.fetch(); let source = await response.text();
    for (const [needle, replacement] of replacements) {
      assert(needle instanceof RegExp ? needle.test(source) : source.includes(needle), `${file} ownership marker ${needle}`);
      source = source.replace(needle, replacement);
    }
    await route.fulfill({ response, body: source });
  });
};
