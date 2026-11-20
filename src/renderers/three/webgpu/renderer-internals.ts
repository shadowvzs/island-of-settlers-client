import { BackSide, DoubleSide, FrontSide, type Material, REVISION } from "three/webgpu";

/**
 * The Three r186 `Renderer` internals the async pipeline compiler relies on: the private draw
 * method it gates, the node/pipeline caches it consults and the per-draw state (render target, MRT,
 * render context attachments, pass side) a deferred compile must replay. Pinned to one revision:
 * another one keeps Three's stock draw path.
 */

const SUPPORTED_REVISION = "186";
/** The render context fields the pipeline key and the attachment formats are read from. */
const CONTEXT_FIELDS = ["activeCubeFace", "activeMipmapLevel", "depth", "depthTexture", "height", "sampleCount",
  "stencil", "textures", "width"] as const;
const RefreshType = { FULL: 2, NONE: 0, SHARED: 1 } as const;

type RenderContextState = Record<(typeof CONTEXT_FIELDS)[number], unknown>;

interface NodeBuilderStateLike {
  fragmentShader: string;
  vertexShader: string;
}

export interface RenderObjectLike {
  context: RenderContextState;
  drawRange: unknown;
  group: unknown;
  material: Material;
  object: { name: string; parent: { name: string } | null; type: string };
  onDispose: () => void;
}

export type DrawArguments = [
  object: { geometry: { drawRange: unknown } },
  material: Material,
  scene: unknown,
  camera: unknown,
  lightsNode: unknown,
  group: unknown,
  clippingContext: unknown,
  passId: unknown
];

/** The r186 `Renderer` members `_renderObjectDirect` and `compileAsync` use. */
export interface RendererInternals {
  _bindings: { updateForRender(object: RenderObjectLike): void; updateSharedForRender(object: RenderObjectLike): void };
  _currentRenderBundle: unknown;
  _currentRenderContext: unknown;
  _geometries: { updateForRender(object: RenderObjectLike): void };
  _isPreCompiling: boolean;
  _nodes: {
    get(object: RenderObjectLike): { nodeBuilderState?: NodeBuilderStateLike };
    getForRender(object: RenderObjectLike): NodeBuilderStateLike;
    getForRenderCacheKey(object: RenderObjectLike): unknown;
    needsRefresh(object: RenderObjectLike): number;
    nodeBuilderCache: Map<unknown, NodeBuilderStateLike>;
    updateAfter(object: RenderObjectLike): void;
    updateBefore(object: RenderObjectLike): void;
    updateForRender(object: RenderObjectLike): void;
  };
  _objects: { get(...args: unknown[]): RenderObjectLike };
  _pipelines: {
    _getRenderCacheKey(object: RenderObjectLike, vertex: object, fragment: object): string;
    caches: Map<string, unknown>;
    getForRender(object: RenderObjectLike, promises?: Promise<unknown>[]): unknown;
    isReady(object: RenderObjectLike): boolean;
    programs: { fragment: Map<string, object>; vertex: Map<string, object> };
    updateForRender(object: RenderObjectLike): void;
  };
  _renderObjectDirect: (...args: DrawArguments) => void;
  backend: { draw(object: RenderObjectLike, info: unknown): void };
  getActiveCubeFace(): number;
  getActiveMipmapLevel(): number;
  getMRT(): unknown;
  getRenderTarget(): unknown;
  info: unknown;
  setMRT(mrt: unknown): void;
  setRenderTarget(target: unknown, activeCubeFace?: number, activeMipmapLevel?: number): void;
}

/** What a draw saw: the renderer target/MRT, the context attachments and the pass's side. */
export interface DrawState {
  activeCubeFace: number;
  activeMipmapLevel: number;
  context: RenderContextState;
  mrt: unknown;
  side: Material["side"];
  target: unknown;
}

export interface DrawPass {
  passId: string | null;
  side: Material["side"];
}

export const supportsGatedDraws = () => REVISION === SUPPORTED_REVISION;

/** Three draws a transparent double-sided material as a back pass and a front pass. */
export const drawPassesOf = (material: Material): DrawPass[] => {
  if (material.transparent !== true || material.side !== DoubleSide || material.forceSinglePass)
    return [{ passId: null, side: material.side }];
  return [{ passId: "backSide", side: BackSide }, { passId: null, side: FrontSide }];
};

const snapshotContext = (context: RenderContextState) => {
  const state = {} as RenderContextState;
  for (const field of CONTEXT_FIELDS) state[field] = context[field];
  return state;
};

const assignContext = (context: RenderContextState, state: RenderContextState) => {
  for (const field of CONTEXT_FIELDS) context[field] = state[field];
};

/** Node state, both programs and the render pipeline already exist: drawing builds nothing. */
export const isCompiled = ({ _nodes: nodes, _pipelines: pipelines }: RendererInternals,
  renderObject: RenderObjectLike) => {
  const state = nodes.get(renderObject).nodeBuilderState ??
    nodes.nodeBuilderCache.get(nodes.getForRenderCacheKey(renderObject));
  if (state === undefined) return false;
  const vertex = pipelines.programs.vertex.get(state.vertexShader);
  const fragment = pipelines.programs.fragment.get(state.fragmentShader);
  if (vertex === undefined || fragment === undefined) return false;
  return pipelines.caches.has(pipelines._getRenderCacheKey(renderObject, vertex, fragment));
};

export const captureDrawState = (internals: RendererInternals, renderObject: RenderObjectLike,
  material: Material): DrawState => ({
  activeCubeFace: internals.getActiveCubeFace(),
  activeMipmapLevel: internals.getActiveMipmapLevel(),
  context: snapshotContext(renderObject.context),
  mrt: internals.getMRT(),
  side: material.side,
  target: internals.getRenderTarget()
});

/** Runs `step` under a captured draw's state (pre-compiling) and puts the current state back afterwards. */
export const withDrawState = <T>(internals: RendererInternals, renderObject: RenderObjectLike, state: DrawState,
  step: () => T) => {
  const material = renderObject.material;
  const current = captureDrawState(internals, renderObject, material);
  internals.setRenderTarget(state.target, state.activeCubeFace, state.activeMipmapLevel);
  internals.setMRT(state.mrt);
  assignContext(renderObject.context, state.context);
  material.side = state.side;
  internals._isPreCompiling = true;
  try { return step(); }
  finally {
    internals._isPreCompiling = false;
    material.side = current.side;
    assignContext(renderObject.context, current.context);
    internals.setMRT(current.mrt);
    internals.setRenderTarget(current.target, current.activeCubeFace, current.activeMipmapLevel);
  }
};

/**
 * Three r186 `Renderer._renderObjectDirect` with `mayDraw` before the node and pipeline work (a
 * `false` skips the draw: nothing is built). Render bundles keep the stock method.
 */
export const createGatedRenderObjectDirect = (
  stock: RendererInternals["_renderObjectDirect"],
  mayDraw: (args: DrawArguments, renderObject: RenderObjectLike) => boolean
) => function gatedRenderObjectDirect(this: RendererInternals, ...args: DrawArguments) {
  if (this._currentRenderBundle !== null) {
    stock.apply(this, args);
    return;
  }
  const [object, material, scene, camera, lightsNode, group, clippingContext, passId] = args;
  const renderObject = this._objects.get(object, material, scene, camera, lightsNode,
    this._currentRenderContext, clippingContext, passId);
  renderObject.drawRange = object.geometry.drawRange;
  renderObject.group = group;
  if (!mayDraw(args, renderObject)) return;
  const refreshType = this._nodes.needsRefresh(renderObject);
  if (refreshType === RefreshType.FULL) {
    this._nodes.updateBefore(renderObject);
    this._geometries.updateForRender(renderObject);
    this._nodes.updateForRender(renderObject);
    this._bindings.updateForRender(renderObject);
  } else if (refreshType === RefreshType.SHARED) {
    this._nodes.updateBefore(renderObject);
    this._nodes.updateForRender(renderObject);
    this._bindings.updateSharedForRender(renderObject);
  }
  this._pipelines.updateForRender(renderObject);
  if (!this._pipelines.isReady(renderObject)) return;
  this.backend.draw(renderObject, this.info);
  if (refreshType !== RefreshType.NONE) this._nodes.updateAfter(renderObject);
};
