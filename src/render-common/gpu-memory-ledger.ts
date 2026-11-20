/**
 * R01 estimated GPU byte ledger (dev flag `?passes=1` only): texture, render-target, renderbuffer
 * and buffer allocations seen through the WebGL2 calls. Sizes are estimates (drivers pad and
 * compress); the drawing buffer itself is not included.
 */
const TEXTURE_CUBE_MAP = 0x8513;
const CUBE_FACE_FIRST = 0x8515;
const CUBE_FACE_LAST = 0x851a;
const TEXTURE0 = 0x84c0;

/** Bytes per texel of the sized internal formats three.js allocates. */
const SIZED_FORMAT_BYTES: Record<number, number> = {
  0x1902: 4, 0x8229: 1, 0x822b: 2, 0x822d: 2, 0x822e: 4, 0x822f: 4, 0x8230: 8, 0x8051: 4,
  0x8056: 2, 0x8057: 2, 0x8058: 4, 0x8059: 4, 0x8814: 16, 0x8815: 12, 0x881a: 8, 0x881b: 8,
  0x81a5: 2, 0x81a6: 4, 0x84f9: 4, 0x88f0: 4, 0x8c3a: 4, 0x8c43: 4, 0x8cac: 4, 0x8cad: 8,
  0x8d48: 1, 0x8d62: 2
};
/** Unsized base formats (WebGL1 style): channels times the type's channel bytes. */
const BASE_FORMAT_CHANNELS: Record<number, number> = {
  0x1903: 1, 0x1906: 1, 0x1907: 3, 0x1908: 4, 0x1909: 1, 0x190a: 2, 0x8227: 2
};
const TYPE_BYTES: Record<number, number> = { 0x1401: 1, 0x1403: 2, 0x1405: 4, 0x1406: 4, 0x140b: 2 };
const FALLBACK_TEXEL_BYTES = 4;

export const texelBytes = (internalFormat: number, type?: number) => {
  const sized = SIZED_FORMAT_BYTES[internalFormat];
  if (sized !== undefined) return sized;
  const channels = BASE_FORMAT_CHANNELS[internalFormat];
  if (channels === undefined) return FALLBACK_TEXEL_BYTES;
  return channels * (TYPE_BYTES[type ?? 0x1401] ?? 1);
};

/** Bytes of `levels` mip levels of a width x height x depth image (each level halves, min 1). */
export const mipChainBytes = (bytesPerTexel: number, width: number, height: number, depth: number, levels: number) => {
  let bytes = 0;
  for (let level = 0; level < levels; level++)
    bytes += Math.max(1, width >> level) * Math.max(1, height >> level) * Math.max(1, depth >> level);
  return bytes * bytesPerTexel;
};

export interface GpuMemoryReport {
  bufferBytes: number;
  buffers: number;
  renderbufferBytes: number;
  /** Textures attached to a framebuffer (render targets). */
  targetTextureBytes: number;
  textureBytes: number;
  textures: number;
}

type Resource = object;

/** Pure bookkeeping: allocations per resource, keyed by level/face so re-uploads replace. */
export const createGpuMemoryLedger = () => {
  const textures = new Map<Resource, Map<string, number>>();
  const targets = new WeakSet<Resource>();
  const renderbuffers = new Map<Resource, number>();
  const buffers = new Map<Resource, number>();

  const setTextureImage = (texture: Resource, key: string, bytes: number) => {
    let images = textures.get(texture);
    if (!images) textures.set(texture, images = new Map());
    images.set(key, bytes);
  };

  const report = (): GpuMemoryReport => {
    let textureBytes = 0, targetTextureBytes = 0;
    for (const [texture, images] of textures) {
      let bytes = 0;
      for (const value of images.values()) bytes += value;
      if (targets.has(texture)) targetTextureBytes += bytes;
      else textureBytes += bytes;
    }
    let renderbufferBytes = 0, bufferBytes = 0;
    for (const bytes of renderbuffers.values()) renderbufferBytes += bytes;
    for (const bytes of buffers.values()) bufferBytes += bytes;
    return { bufferBytes, buffers: buffers.size, renderbufferBytes, targetTextureBytes, textureBytes,
      textures: textures.size };
  };

  return {
    deleteBuffer: (buffer: Resource) => { buffers.delete(buffer); },
    deleteRenderbuffer: (renderbuffer: Resource) => { renderbuffers.delete(renderbuffer); },
    deleteTexture: (texture: Resource) => { textures.delete(texture); },
    markTarget: (texture: Resource) => { targets.add(texture); },
    report,
    setBuffer: (buffer: Resource, bytes: number) => { buffers.set(buffer, bytes); },
    setRenderbuffer: (renderbuffer: Resource, bytes: number) => { renderbuffers.set(renderbuffer, bytes); },
    setTextureImage,
    /** texStorage replaces every image of the texture. */
    setTextureStorage: (texture: Resource, bytes: number) => {
      textures.set(texture, new Map([["storage", bytes]]));
    }
  };
};
type GpuMemoryLedger = ReturnType<typeof createGpuMemoryLedger>;

interface BindingState {
  activeUnit: number;
  buffers: Map<number, Resource | null>;
  ledger: GpuMemoryLedger;
  renderbuffer: Resource | null;
  textures: Map<string, Resource | null>;
}

const states = new WeakMap<object, BindingState>();
const stateOf = (gl: object) => {
  let state = states.get(gl);
  if (!state) states.set(gl, state = { activeUnit: 0, buffers: new Map(), ledger: createGpuMemoryLedger(),
    renderbuffer: null, textures: new Map() });
  return state;
};

const bindingTarget = (target: number) =>
  (target >= CUBE_FACE_FIRST && target <= CUBE_FACE_LAST ? TEXTURE_CUBE_MAP : target);
const boundTexture = (state: BindingState, target: number) =>
  state.textures.get(`${state.activeUnit}:${bindingTarget(target)}`) ?? null;
const faceCount = (target: number) => (target === TEXTURE_CUBE_MAP ? 6 : 1);

/** Width/height of a texImage2D DOM source (image, canvas, video, ImageBitmap, ImageData). */
const sourceSize = (source: unknown) => {
  const value = source as { height?: number; videoHeight?: number; videoWidth?: number; width?: number } | null;
  return { height: value?.videoHeight || value?.height || 0, width: value?.videoWidth || value?.width || 0 };
};

type Method = (this: WebGL2RenderingContext, ...args: never[]) => unknown;
const wrap = (prototype: Record<string, unknown>, name: string,
  observe: (gl: WebGL2RenderingContext, state: BindingState, args: unknown[]) => void) => {
  const original = prototype[name] as Method | undefined;
  if (!original) return;
  prototype[name] = function (this: WebGL2RenderingContext, ...args: unknown[]) {
    const result = original.apply(this, args as never[]);
    observe(this, stateOf(this), args);
    return result;
  };
};

const texImage2DBytes = (args: unknown[]) => {
  const [, , internalFormat] = args as number[];
  if (args.length >= 8) {
    const [, , , width, height, , , type] = args as number[];
    return mipChainBytes(texelBytes(internalFormat!, type), width!, height!, 1, 1);
  }
  const { height, width } = sourceSize(args[5]);
  return mipChainBytes(texelBytes(internalFormat!, args[4] as number), width, height, 1, 1);
};

const installTextureWraps = (prototype: Record<string, unknown>) => {
  wrap(prototype, "activeTexture", (_gl, state, [unit]) => { state.activeUnit = (unit as number) - TEXTURE0; });
  wrap(prototype, "bindTexture", (_gl, state, [target, texture]) => {
    state.textures.set(`${state.activeUnit}:${target as number}`, (texture as Resource | null) ?? null);
  });
  wrap(prototype, "texStorage2D", (_gl, state, args) => {
    const [target, levels, format, width, height] = args as number[];
    const texture = boundTexture(state, target!);
    if (texture) state.ledger.setTextureStorage(texture,
      mipChainBytes(texelBytes(format!), width!, height!, 1, levels!) * faceCount(target!));
  });
  wrap(prototype, "texStorage3D", (_gl, state, args) => {
    const [target, levels, format, width, height, depth] = args as number[];
    const texture = boundTexture(state, target!);
    if (texture) state.ledger.setTextureStorage(texture, mipChainBytes(texelBytes(format!), width!, height!,
      depth!, levels!));
  });
  wrap(prototype, "texImage2D", (_gl, state, args) => {
    const texture = boundTexture(state, args[0] as number);
    if (texture) state.ledger.setTextureImage(texture, `${args[0]}:${args[1]}`, texImage2DBytes(args));
  });
  wrap(prototype, "texImage3D", (_gl, state, args) => {
    const [target, level, format, width, height, depth, , , type] = args as number[];
    const texture = boundTexture(state, target!);
    if (texture) state.ledger.setTextureImage(texture, `${target}:${level}`,
      mipChainBytes(texelBytes(format!, type), width!, height!, depth!, 1));
  });
  wrap(prototype, "compressedTexImage2D", (_gl, state, args) => {
    const texture = boundTexture(state, args[0] as number);
    const data = args[6] as ArrayBufferView | number | undefined;
    const bytes = typeof data === "number" ? data : data?.byteLength ?? 0;
    if (texture) state.ledger.setTextureImage(texture, `${args[0]}:${args[1]}`, bytes);
  });
  wrap(prototype, "framebufferTexture2D", (_gl, state, [, , , texture]) => {
    if (texture) state.ledger.markTarget(texture as Resource);
  });
  wrap(prototype, "framebufferTextureLayer", (_gl, state, [, , texture]) => {
    if (texture) state.ledger.markTarget(texture as Resource);
  });
  wrap(prototype, "deleteTexture", (_gl, state, [texture]) => {
    if (texture) state.ledger.deleteTexture(texture as Resource);
  });
};

const installBufferWraps = (prototype: Record<string, unknown>) => {
  wrap(prototype, "bindRenderbuffer", (_gl, state, [, renderbuffer]) => {
    state.renderbuffer = (renderbuffer as Resource | null) ?? null;
  });
  wrap(prototype, "renderbufferStorage", (_gl, state, [, format, width, height]) => {
    if (state.renderbuffer) state.ledger.setRenderbuffer(state.renderbuffer,
      texelBytes(format as number) * (width as number) * (height as number));
  });
  wrap(prototype, "renderbufferStorageMultisample", (_gl, state, [, samples, format, width, height]) => {
    if (state.renderbuffer) state.ledger.setRenderbuffer(state.renderbuffer, texelBytes(format as number) *
      (width as number) * (height as number) * Math.max(1, samples as number));
  });
  wrap(prototype, "deleteRenderbuffer", (_gl, state, [renderbuffer]) => {
    if (renderbuffer) state.ledger.deleteRenderbuffer(renderbuffer as Resource);
  });
  wrap(prototype, "bindBuffer", (_gl, state, [target, buffer]) => {
    state.buffers.set(target as number, (buffer as Resource | null) ?? null);
  });
  wrap(prototype, "bufferData", (_gl, state, [target, data]) => {
    const buffer = state.buffers.get(target as number);
    const bytes = typeof data === "number" ? data : (data as ArrayBufferView | null)?.byteLength ?? 0;
    if (buffer) state.ledger.setBuffer(buffer, bytes);
  });
  wrap(prototype, "deleteBuffer", (_gl, state, [buffer]) => {
    if (buffer) state.ledger.deleteBuffer(buffer as Resource);
  });
};

let installed = false;

/**
 * Observes the allocation calls of every WebGL2 context created afterwards (install before the
 * renderer exists). Dev flag only; the wrapped calls run unchanged.
 */
export const installGpuMemoryLedger = (prototype?: object) => {
  const target = prototype ?? globalThis.WebGL2RenderingContext?.prototype;
  if (!target || (prototype === undefined && installed)) return;
  if (prototype === undefined) installed = true;
  installTextureWraps(target as Record<string, unknown>);
  installBufferWraps(target as Record<string, unknown>);
};

/** The estimated bytes of `gl`, or null when the ledger was not installed for it. */
export const readGpuMemory = (gl: object): GpuMemoryReport | null => states.get(gl)?.ledger.report() ?? null;
