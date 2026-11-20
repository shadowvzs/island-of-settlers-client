import { createWriteStream } from "node:fs";
import type { BrowserContext, CDPSession, Page } from "playwright-core";

/**
 * GPU-LIFECYCLE-03 page probe (bench only). Counts live WebGL objects per live context by wrapping
 * the create/delete calls, live window/document/node listeners, live intervals and workers, and
 * exposes the island's WebGLRenderer through a diagnostic route patch. Production code is unchanged.
 */
const installProbe = () => {
  const host = window as any;
  host.__name = (value: unknown) => value;
  const kinds = ["Buffer", "Framebuffer", "Program", "Renderbuffer", "Shader", "Texture", "VertexArray"];
  const contexts: Array<{ gl: WeakRef<WebGL2RenderingContext>; live: Record<string, Set<object>> }> = [];
  const contextLive = new WeakMap<object, Record<string, Set<object>>>();
  const liveFor = (gl: WebGL2RenderingContext) => {
    let live = contextLive.get(gl);
    if (live) return live;
    live = Object.fromEntries(kinds.map(kind => [kind, new Set<object>()]));
    contextLive.set(gl, live);
    contexts.push({ gl: new WeakRef(gl), live });
    return live;
  };
  const proto = WebGL2RenderingContext.prototype as any;
  /** TRACE: which rendered object/attribute created each live GL buffer (three patch below). */
  const bufferTags = new Map<object, { attribute?: WeakRef<object>; epoch: number; owner?: WeakRef<object>;
    tag: string }>();
  let epoch = 0;
  const describe = (object: any) => {
    const names: string[] = [];
    for (let node = object; node && names.length < 4; node = node.parent)
      names.push(node.name || node.type || "?");
    return names.join("<");
  };
  /** The attribute's place on the drawn object; "other": not on it when the buffer was created. */
  const slotOf = (attribute: any, object: any) => {
    const geometry = object?.geometry;
    const named = Object.entries(geometry?.attributes ?? {}).find(([, value]) => value === attribute)?.[0];
    if (named) return named;
    if (geometry?.index === attribute) return "index";
    if (object?.instanceMatrix === attribute) return "instanceMatrix";
    if (object?.instanceColor === attribute) return "instanceColor";
    return "other";
  };
  host.__gpuTagBuffer = (buffer: object, attribute: any, object: any) => {
    const geometry = object?.geometry, slot = slotOf(attribute, object);
    bufferTags.set(buffer, { attribute: attribute && new WeakRef(attribute), epoch,
      owner: object && new WeakRef(object),
      tag: `${describe(object)} | ${geometry?.type}.${slot} | ${origin(object)}` });
  };
  const origin = (value: any) => String(value?.__createdStack ?? "").split("\n")
    .filter(line => line.includes("/src/")).slice(0, 3)
    .map(line => line.trim().replace(/^at /, "").replace(/\(?https?:\/\/[^/]+\/src\//, "")).join(" < ");
  /** Geometries/textures three.js registered and has not seen disposed, with their creators. */
  const resourceTags = new Map<object, { epoch: number; owner?: WeakRef<object>; tag: string }>();
  host.__gpuTrackGeometry = (geometry: any, object: any) => resourceTags.set(geometry, { epoch,
    owner: object && new WeakRef(object),
    tag: `geometry ${describe(object)} | ${geometry.name || geometry.type} | ${origin(object)}` });
  host.__gpuTrackTexture = (texture: any) => resourceTags.set(texture, { epoch,
    tag: `texture ${texture.name || texture.constructor.name} ${texture.image?.width ?? "?"}x` +
      `${texture.image?.height ?? "?"} | ${origin(texture)}` });
  host.__gpuUntrack = (value: object) => resourceTags.delete(value);
  for (const kind of kinds) {
    const create = proto[`create${kind}`], remove = proto[`delete${kind}`];
    proto[`create${kind}`] = function(...args: unknown[]) {
      const value = create.apply(this, args);
      if (value) liveFor(this)[kind]!.add(value);
      return value;
    };
    proto[`delete${kind}`] = function(value: object | null) {
      if (value) { liveFor(this)[kind]!.delete(value); bufferTags.delete(value); }
      return remove.call(this, value);
    };
  }
  const listenerTargets: Array<{ ref: WeakRef<EventTarget>; set: Set<string> }> = [];
  const listenerSets = new WeakMap<EventTarget, Set<string>>();
  const listenerIds = new WeakMap<object, number>();
  let nextListenerId = 1;
  const listenerKey = (type: string, listener: object, options: unknown) => {
    let id = listenerIds.get(listener);
    if (!id) { id = nextListenerId++; listenerIds.set(listener, id); }
    const capture = typeof options === "boolean" ? options : Boolean((options as any)?.capture);
    return `${type}|${capture}|${id}`;
  };
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  /** Add-site stacks of live window/document listeners: a handoff leak repeats the same site. */
  const globalListenerStacks = new Map<string, string>();
  const forget = (target: EventTarget, key: string) => {
    listenerSets.get(target)?.delete(key);
    globalListenerStacks.delete(key);
  };
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (listener) {
      let set = listenerSets.get(this);
      if (!set) { set = new Set(); listenerSets.set(this, set); listenerTargets.push({ ref: new WeakRef(this), set }); }
      const key = listenerKey(type, listener as object, options);
      set.add(key);
      const scope = this === window ? "window" : "document";
      if (this === window || this === document)
        globalListenerStacks.set(key, `${scope}:${type} | ${origin({ __createdStack: new Error().stack })}`);
      // The browser drops a { signal } listener on abort without a removeEventListener call.
      const signal = (options as AddEventListenerOptions | undefined)?.signal;
      if (signal) add.call(signal, "abort", () => forget(this, key), { once: true });
    }
    return add.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function(type, listener, options) {
    if (listener) forget(this, listenerKey(type, listener as object, options));
    return remove.call(this, type, listener, options);
  };
  const intervals = new Set<number>();
  const setIntervalNative = window.setInterval.bind(window), clearIntervalNative = window.clearInterval.bind(window);
  window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    const id = setIntervalNative(handler, delay, ...args) as unknown as number;
    intervals.add(id);
    return id;
  }) as typeof window.setInterval;
  window.clearInterval = ((id?: number) => {
    if (id !== undefined) intervals.delete(id);
    clearIntervalNative(id);
  }) as typeof window.clearInterval;
  let liveWorkers = 0;
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    private ended = false;
    constructor(url: string | URL, options?: WorkerOptions) { super(url, options); liveWorkers++; }
    terminate() { if (!this.ended) { liveWorkers--; this.ended = true; } super.terminate(); }
  };
  const countListeners = () => {
    const counts = { detachedNodes: 0, document: 0, nodes: 0, other: 0, window: 0 };
    const byType: Record<string, number> = {};
    for (const { ref, set } of listenerTargets) {
      const target = ref.deref();
      if (!target || !set.size) continue;
      let bucket: keyof typeof counts = "other";
      if (target === window) bucket = "window";
      else if (target === document) bucket = "document";
      else if (target instanceof Node) bucket = target.isConnected ? "nodes" : "detachedNodes";
      counts[bucket] += set.size;
      if (bucket === "window" || bucket === "document" || bucket === "other") {
        const name = target === window || target === document ? bucket : target.constructor.name;
        for (const key of set) {
          const type = `${name}:${key.split("|")[0]}`;
          byType[type] = (byType[type] ?? 0) + 1;
        }
      }
    }
    return { ...counts, byType };
  };
  host.__gpuLifecycle = {
    mark: () => { epoch++; },
    /** Live buffers created since the last mark, grouped by creating object/attribute. */
    /** Live window/document listeners grouped by add site (largest first). */
    globalListenerSites: () => {
      const groups: Record<string, number> = {};
      for (const site of globalListenerStacks.values()) groups[site] = (groups[site] ?? 0) + 1;
      return Object.entries(groups).sort((first, second) => second[1] - first[1]).slice(0, 60);
    },
    tagsSinceMark: () => {
      const groups: Record<string, number> = {};
      /** Detached: the owning object is no longer under a Scene (a leak unless it is cached). */
      const placement = (owner?: WeakRef<object>) => {
        if (!owner) return "unowned";
        let node: any = owner.deref();
        if (!node) return "collected";
        while (node.parent) node = node.parent;
        return node.isScene ? "attached" : "detached";
      };
      /** A live buffer whose attribute was garbage collected can never be deleted by three.js. */
      const attributeState = (attribute?: WeakRef<object>) => {
        if (!attribute) return "";
        return attribute.deref() ? "" : " orphaned";
      };
      const tagged = [...bufferTags.values(), ...[...resourceTags.values()].map(entry => ({ ...entry,
        attribute: undefined }))];
      for (const { attribute, epoch: created, owner, tag } of tagged)
        if (created === epoch) {
          const key = `[${placement(owner)}${attributeState(attribute)}] ${tag}`;
          groups[key] = (groups[key] ?? 0) + 1;
        }
      return Object.entries(groups).sort((first, second) => second[1] - first[1]).slice(0, 500);
    },
    renderer: null,
    sample: () => {
      const gl: Record<string, number> = {};
      let liveContexts = 0;
      for (const entry of contexts) {
        const context = entry.gl.deref();
        if (!context || context.isContextLost()) continue;
        liveContexts++;
        for (const kind of kinds) gl[kind] = (gl[kind] ?? 0) + entry.live[kind]!.size;
      }
      const renderer = host.__gpuLifecycle.renderer;
      const three = renderer ? { geometries: renderer.info.memory.geometries,
        programs: renderer.info.programs?.length ?? 0, textures: renderer.info.memory.textures } : null;
      return { canvases: document.querySelectorAll("canvas").length, gl, intervals: intervals.size,
        listeners: countListeners(), liveContexts, three, workers: liveWorkers };
    }
  };
};

/** Diagnostic route: expose the island renderer; the on-disk module is untouched. */
const RENDERER_MODULE = "**/src/renderers/three/create-three-renderer.ts*";
const exposeRenderer = async (page: Page) => page.route(RENDERER_MODULE, async route => {
  const response = await route.fetch();
  const source = await response.text();
  const anchor = "return result;";
  if (source.split(anchor).length !== 2) throw new Error("create-three-renderer anchor is not unique");
  const handle = "window.__gpuLifecycle.renderer = renderer; window.__gpuLifecycle.api = result;";
  await route.fulfill({ body: source.replace(anchor, `${handle} ${anchor}`), response });
});

const STACK = "this.__createdStack = new Error().stack;";
/** three.js source patches (esbuild-printed dep bundle); each applies wherever its anchor exists. */
const THREE_TRACE_PATCHES: Array<[RegExp, (match: string) => string]> = [
  [/const buffer = gl\.createBuffer\(\);/,
    match => `${match} window.__gpuTagBuffer?.(buffer, attribute, window.__gpuCurrentObject);`],
  [/const buffergeometry = geometries\.get\(\s*object,\s*geometry\s*\);/,
    match => `window.__gpuCurrentObject = object; ${match}`],
  // Index buffers upload at draw time, after the whole render list was projected: tag the drawn object.
  [/function setup\(\s*object,\s*material,\s*program,\s*geometry,\s*index\s*\)\s*\{/,
    match => `${match} window.__gpuCurrentObject = object;`],
  [/this\.isMesh = true;/, match => `${match} ${STACK}`],
  [/this\.isTexture = true;/, match => `${match} ${STACK}`],
  [/geometry\.addEventListener\("dispose", onGeometryDispose\);/,
    match => `${match} window.__gpuTrackGeometry?.(geometry, object);`],
  [/function onGeometryDispose\(event\) \{/, match => `${match} window.__gpuUntrack?.(event.target);`],
  [/texture\.addEventListener\("dispose", onTextureDispose\);/,
    match => `${match} window.__gpuTrackTexture?.(texture);`],
  [/function onTextureDispose\(event\) \{/, match => `${match} window.__gpuUntrack?.(event.target);`]
];

/** Diagnostic route: attribute live buffers, geometries and textures to their creators. */
const traceThreeResources = async (page: Page) => page.route(/\/deps\/[^/]*\.js(\?|$)/, async route => {
  const response = await route.fetch();
  let body = await response.text();
  for (const [anchor, patch] of THREE_TRACE_PATCHES) body = body.replace(anchor, patch);
  await route.fulfill({ body, response });
});

export const installGpuLifecycleProbe = async (context: BrowserContext, page: Page, trace = false) => {
  await context.addInitScript(installProbe);
  await exposeRenderer(page);
  if (trace) await traceThreeResources(page);
};

export interface LifecycleSample {
  at: number;
  heapUsedMb: number;
  label: string;
  [key: string]: unknown;
}

/** Live instances sharing the prototype of `expression`'s value (CDP queryObjects collects first). */
const countLiveInstances = async (cdp: CDPSession, expression: string) => {
  // The result array must not outlive the count: an unreleased handle would itself retain the instances.
  const objectGroup = "gpu-lifecycle-count";
  try {
    const { result } = await cdp.send("Runtime.evaluate", { expression, objectGroup });
    if (!result.objectId) return null;
    const { objects } = await cdp.send("Runtime.queryObjects", { objectGroup, prototypeObjectId: result.objectId });
    const { result: length } = await cdp.send("Runtime.callFunctionOn", {
      functionDeclaration: "function() { return this.length; }", objectGroup, objectId: objects.objectId!,
      returnByValue: true });
    return length.value as number;
  } finally {
    await cdp.send("Runtime.releaseObjectGroup", { objectGroup });
  }
};

/** Two forced collections, then the probe counters and the used JS heap. */
export const sampleLifecycle = async (page: Page, cdp: CDPSession, label: string): Promise<LifecycleSample> => {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const heap = await cdp.send("Runtime.getHeapUsage");
  const counters = await page.evaluate(() => (window as any).__gpuLifecycle.sample());
  // A replaced island must leave no renderer behind: more than one live instance retains a runtime.
  const liveRenderers = await countLiveInstances(cdp,
    "window.__gpuLifecycle.renderer && Object.getPrototypeOf(window.__gpuLifecycle.renderer)");
  return { at: Date.now(), heapUsedMb: Math.round(heap.usedSize / 1024 / 10.24) / 100, label, liveRenderers,
    ...counters };
};

/** Streams a V8 heap snapshot to `path` (retainer analysis of a suspected runtime leak). */
export const writeHeapSnapshot = async (cdp: CDPSession, path: string) => {
  const file = createWriteStream(path);
  const onChunk = ({ chunk }: { chunk: string }) => { file.write(chunk); };
  cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
  await new Promise<void>(resolve => file.end(resolve));
};
