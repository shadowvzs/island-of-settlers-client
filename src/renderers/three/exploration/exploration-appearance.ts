import { ThreeWorkerPack } from "@workers/game-three-worker";
import {
  type AnimationClip,
  AnimationMixer,
  Box3,
  Group,
  type Object3D
} from "three";
import type { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";

import type {
  ExplorationAppearanceLease,
  ExplorationSessionIdentity
} from "../../../app/exploration/contracts";
import type { ExplorationAppearanceFrame } from "../../../render-common/exploration/exploration-frame";
import { SPYGLASS_TOOL_SCALE } from "../../../render-common/wares/spyglass-parts";
import { WORKER_HEIGHT } from "../../../render-common/workers/worker-dimensions";
import type { WorkerAppearance, WorkerNation } from "../../../render-common/workers/worker-unit";
import { createSpyglassIconModel } from "../settlement/spyglass-icon-model";
import { createWorkerBodyPool } from "../worker-body-pool";
import { createWorkerPackAssets } from "../worker-pack-assets";
import { createExplorationJumpPose } from "./exploration-jump-pose";
import {
  type ExplorationAppearanceResolution,
  type ExplorationPortraitSource,
  resolveExplorationAppearance
} from "./exploration-portrait";
import { createExplorationSpyglassAttachment } from "./spyglass-attachment";

export {
  EXPLORATION_APPEARANCE_ASSET_GAPS,
  EXPLORATION_NATIONS,
  EXPLORATION_PORTRAIT_BODIES,
  type ExplorationAppearanceGap,
  type ExplorationAppearanceGapField,
  type ExplorationAppearanceGapReason,
  type ExplorationAppearanceResolution,
  type ExplorationGender,
  explorationNationBodies,
  type ExplorationPortraitSource,
  isExplorationWorkerNation,
  resolveExplorationAppearance
} from "./exploration-portrait";

/** Measurements used by the camera; the body is scaled to a human-height world figure once. */
export interface ExplorationRigMetrics {
  bodyHeight: number;
  eyeHeight: number;
  scale: number;
}

export const measureExplorationRig = (
  root: Object3D,
  bodyHeight = WORKER_HEIGHT,
  eyeRatio = 0.91
): ExplorationRigMetrics => {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  const naturalHeight = box.isEmpty() ? 0 : box.max.y - box.min.y;
  const factor = naturalHeight > 1e-5 ? Math.max(0.01, bodyHeight) / naturalHeight : 1;
  if (factor !== 1) {
    root.scale.multiplyScalar(factor);
    root.updateMatrixWorld(true);
  }
  // Ground the feet even when the source already has the target height: the Tripo asset origin
  // is not guaranteed to be at its sole, which otherwise leaves the possessed body floating.
  root.updateMatrixWorld(true);
  const grounded = new Box3().setFromObject(root);
  if (!grounded.isEmpty()) root.position.y -= grounded.min.y;
  const finalHeight = naturalHeight > 1e-5 ? Math.max(0.01, bodyHeight) : 1.16 * root.scale.y;
  return {
    bodyHeight: finalHeight,
    eyeHeight: finalHeight * Math.min(0.99, Math.max(0.5, eyeRatio)),
    scale: factor
  };
};

/** The parts that can be hidden independently with today's single-mesh Tripo bodies. */
export interface ExplorationBodyVisibility {
  bodyVisible: boolean;
  headVisible: boolean;
  hiddenParts: readonly string[];
  reason: "approach" | "eye-level" | "hidden";
  spyglassVisible: boolean;
}

/**
 * At eye view the camera sits inside the single skinned body mesh. Hiding the whole explorer group is
 * the only correct option until a separate head/hair mesh exists; no part is drawn through the near plane.
 */
export const explorationBodyVisibility = (
  appearance: Readonly<ExplorationAppearanceFrame> | null | undefined
): ExplorationBodyVisibility => {
  if (!appearance?.visible)
    return { bodyVisible: false, headVisible: false, hiddenParts: ["body", "head", "hair", "face",
      "facialHair", "spyglass"], reason: "hidden", spyglassVisible: false };
  if (appearance.pose.mode === "eye")
    return { bodyVisible: false, headVisible: false, hiddenParts: ["body", "head", "hair", "face",
      "facialHair", "spyglass"], reason: "eye-level", spyglassVisible: false };
  return { bodyVisible: true, headVisible: true, hiddenParts: [], reason: "approach", spyglassVisible: true };
};

export interface ExplorationLoadedBody {
  clips: readonly AnimationClip[];
  /** The pack's manifest record for this body (may carry gender/label metadata). */
  entry?: object;
  mixer: AnimationMixer;
  root: Object3D;
  dispose: () => void;
}

export interface ExplorationBodyLoader {
  load: (appearance: WorkerAppearance) => Promise<ExplorationLoadedBody>;
  /** Releases loader-owned caches. A shared-pool wrapper is a no-op. */
  dispose: () => void;
  /** The nation of the current crowd; lets the portrait follow the same live source as the body. */
  nation?: () => WorkerNation;
  /** Notifies after the crowd/pool behind the loader was replaced; returns its unsubscribe. */
  onSourceChange?: (listener: () => void) => () => void;
}

export interface ExplorationBodySource {
  current: () => ExplorationBodyLoader | undefined;
  nation?: () => WorkerNation;
  /** Increments when `current` points at another crowd body pool. */
  revision?: () => number;
  subscribe?: (listener: () => void) => () => void;
}

/**
 * Stable facade over a crowd-owned body pool. It resolves the live crowd at load time instead of
 * capturing the startup pool, and retries a load that lost its pool to a nation replacement.
 */
export const createLiveExplorationBodyLoader = (
  source: ExplorationBodySource
): ExplorationBodyLoader => {
  const currentLoader = () => {
    const loader = source.current();
    if (!loader) throw new Error("The worker crowd is not ready for exploration");
    return loader;
  };
  return {
    async load(appearance) {
      const revision = source.revision?.() ?? 0;
      const loader = currentLoader();
      try {
        return await loader.load(appearance);
      } catch (error) {
        // A disposed cache from the replaced crowd would otherwise become a possession failure.
        const replacement = source.current();
        const changed = replacement !== loader || (source.revision?.() ?? 0) !== revision;
        if (!replacement || !changed) throw error;
        return replacement.load(appearance);
      }
    },
    dispose: () => { /* The renderer owns the crowd and its body pool. */ },
    ...(source.nation ? { nation: source.nation } : {}),
    ...(source.subscribe ? { onSourceChange: source.subscribe } : {})
  };
};

/**
 * Explorer-only pack and body pool. Nothing here is shared with ordinary workers, so disposing the
 * adapter can release every texture, geometry, skeleton and material it loaded exactly once.
 */
export const createOwnedExplorationBodyLoader = (textures: KTX2Loader): ExplorationBodyLoader => {
  // Read the document only when the browser actually creates the loader; node tests import this module freely.
  const workerAssets = new URL("./workers/", document.baseURI).href;
  const pack = new ThreeWorkerPack(`${workerAssets}tripo/`, textures);
  const shared = createWorkerPackAssets(pack);
  const bodies = createWorkerBodyPool(pack, undefined, shared);
  let disposed = false;
  return {
    async load(appearance) {
      if (disposed) throw new Error("Exploration body loader already disposed");
      const body = await bodies.load(appearance);
      if (disposed) {
        body.dispose();
        throw new Error("Exploration body loaded after its loader was disposed");
      }
      return {
        clips: body.clips,
        entry: body.entry,
        mixer: body.mixer,
        root: body.root,
        dispose: body.dispose
      };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      bodies.dispose();
      shared.dispose();
      pack.dispose();
    }
  };
};

/**
 * Wraps the coordinator's shared `createWorkerBodyPool`. Disposing the lease releases only this body's
 * skeleton/material clones; the shared pack stays alive for ordinary workers that still use it.
 */
export const createSharedExplorationBodyLoader = (
  pool: Pick<ReturnType<typeof createWorkerBodyPool>, "load">
): ExplorationBodyLoader => ({
  async load(appearance) {
    const body = await pool.load(appearance);
    return {
      clips: body.clips,
      entry: body.entry,
      mixer: body.mixer,
      root: body.root,
      dispose: body.dispose
    };
  },
  dispose: () => { /* The shared pool belongs to the settlement crowd. */ }
});

export interface ExplorationSpyglassProp {
  root: Object3D;
  dispose: () => void;
}

/** Canonical telescope recipe (the same model as inventory/tool art), fitted to the worker's hand scale. */
export const createExplorationSpyglass = (): ExplorationSpyglassProp => {
  const model = createSpyglassIconModel();
  model.root.name = "exploration_spyglass";
  model.root.scale.setScalar(SPYGLASS_TOOL_SCALE);
  return { dispose: model.dispose, root: model.root };
};

export interface ExplorationAppearanceLeaseHandle extends ExplorationAppearanceLease {
  /** The resolved portrait recipe, including honest asset gaps. */
  descriptor: () => ExplorationAppearanceResolution | null;
  /** Stable eye height measured from the scaled body rig (about 1.7 world units). */
  eyeHeight: () => number;
  identity: ExplorationSessionIdentity;
}

export interface ExplorationAppearanceAdapterOptions {
  bodyHeight?: number;
  createSpyglass?: () => ExplorationSpyglassProp;
  eyeRatio?: number;
  groundHeight: (x: number, z: number) => number;
  /** Called after a load settles; a false result releases the body instead of installing it. */
  isCurrentIdentity?: (identity: Readonly<ExplorationSessionIdentity>) => boolean;
  loader: ExplorationBodyLoader;
  now?: () => number;
  /** A live source change could not rebuild the body; the owner may exit instead of showing it stale. */
  onRefreshError?: (error: unknown) => void;
  parent: Object3D;
  portrait: ExplorationPortraitSource | (() => ExplorationPortraitSource);
}

export interface ExplorationAppearanceAdapterHandle {
  acquire: (identity: ExplorationSessionIdentity) => Promise<ExplorationAppearanceLeaseHandle>;
  /** Idempotent teardown of the active lease and every loader-owned asset. */
  dispose: () => void;
  stats: () => { active: boolean; disposed: boolean; pending: number };
}

interface ActiveExplorer {
  jumpPose: ReturnType<typeof createExplorationJumpPose>;
  appearance: ExplorationAppearanceFrame | null;
  body: ExplorationLoadedBody;
  disposed: boolean;
  group: Group;
  identity: ExplorationSessionIdentity;
  lastNow: number;
  metrics: ExplorationRigMetrics;
  resolution: ExplorationAppearanceResolution;
  spyglass: ExplorationSpyglassProp;
  spyglassAttachment: ReturnType<typeof createExplorationSpyglassAttachment>;
}

interface ExplorerSlot {
  disposed: boolean;
  explorer: ActiveExplorer | null;
  identity: ExplorationSessionIdentity;
}

interface PreparedExplorer {
  body: ExplorationLoadedBody;
  identity: ExplorationSessionIdentity;
  resolution: ExplorationAppearanceResolution;
}

const copyAppearance = (appearance: ExplorationAppearanceFrame | null) =>
  appearance ? { ...appearance, pose: { ...appearance.pose } } : null;

/**
 * Transient portrait-like explorer body. It is not a simulation actor, never enters a worker pool, and
 * owns exactly one body instance plus its telescope. The frozen contract only exposes acquire/update/
 * dispose; the extra descriptor/eyeHeight accessors let 01G tune the camera from the measured rig.
 */
export const createExplorationAppearanceAdapter = (
  options: ExplorationAppearanceAdapterOptions
): ExplorationAppearanceAdapterHandle => {
  const now = options.now ?? (() => (typeof performance === "undefined" ? Date.now() : performance.now()));
  let active: ExplorerSlot | null = null;
  let disposed = false;
  let pending = 0;
  let request = 0;
  let refreshRequest = 0;
  let loaderDisposed = false;

  const disposeLoader = () => {
    if (loaderDisposed) return;
    loaderDisposed = true;
    options.loader.dispose();
  };

  const disposeExplorer = (explorer: ActiveExplorer) => {
    if (explorer.disposed) return;
    explorer.disposed = true;
    explorer.group.removeFromParent();
    explorer.spyglass.dispose();
    explorer.body.dispose();
  };

  const removeActive = () => {
    const slot = active;
    active = null;
    refreshRequest++;
    if (!slot) return;
    slot.disposed = true;
    const explorer = slot.explorer;
    slot.explorer = null;
    if (explorer) disposeExplorer(explorer);
  };

  const applyExplorerAppearance = (
    explorer: ActiveExplorer,
    appearance: ExplorationAppearanceFrame | null
  ) => {
    if (explorer.disposed) return;
    explorer.jumpPose.reset();
    const visibility = explorationBodyVisibility(appearance);
    explorer.group.visible = visibility.bodyVisible;
    explorer.spyglass.root.visible = visibility.spyglassVisible && explorer.spyglassAttachment.attached();
    if (!appearance || (!visibility.bodyVisible && !appearance.jump)) return;
    const x = Number.isFinite(appearance.pose.x) ? appearance.pose.x : 0;
    const z = Number.isFinite(appearance.pose.z) ? appearance.pose.z : 0;
    const queriedGround = options.groundHeight(x, z);
    const ground = Number.isFinite(queriedGround) ? queriedGround : 0;
    explorer.group.position.set(x, appearance.feetY ?? ground, z);
    explorer.group.rotation.set(0, appearance.pose.yaw, 0);
    const current = now();
    const delta = Math.max(0, Math.min(0.1, (current - explorer.lastNow) / 1000));
    explorer.lastNow = current;
    explorer.spyglassAttachment.reset();
    explorer.body.mixer.update(delta);
    explorer.jumpPose.apply(appearance.jump);
    explorer.spyglassAttachment.apply(appearance.spyglass);
  };

  const prepareExplorer = async (identity: ExplorationSessionIdentity): Promise<PreparedExplorer> => {
    if (disposed) throw new Error("Exploration appearance adapter disposed");
    if (options.isCurrentIdentity && !options.isCurrentIdentity(identity))
      throw new Error("Stale exploration appearance identity");
    const portrait = typeof options.portrait === "function" ? options.portrait() : options.portrait;
    const resolution = resolveExplorationAppearance(portrait);
    const body = await options.loader.load(resolution.appearance);
    return { body, identity: { ...identity }, resolution };
  };

  const installExplorer = (prepared: PreparedExplorer): ActiveExplorer => {
    let group: Group | null = null;
    let spyglass: ExplorationSpyglassProp | null = null;
    try {
      const loaded = prepared.body;
      const metrics = measureExplorationRig(loaded.root, options.bodyHeight ?? WORKER_HEIGHT,
        options.eyeRatio ?? 0.91);
      group = new Group();
      group.name = "exploration-explorer";
      group.visible = false;
      group.add(loaded.root);
      spyglass = (options.createSpyglass ?? createExplorationSpyglass)();
      const spyglassAttachment = createExplorationSpyglassAttachment(loaded.root, spyglass.root);
      spyglassAttachment.apply(false);
      group.userData.spyglassAttachmentReason = spyglassAttachment.reason();
      options.parent.add(group);
      const idleClip = loaded.clips.find(clip => clip.name === "idle_breathe") ?? loaded.clips[0];
      if (idleClip) loaded.mixer.clipAction(idleClip).reset().play();
      return {
        jumpPose: createExplorationJumpPose(loaded.root),
        appearance: null,
        body: loaded,
        disposed: false,
        group,
        identity: { ...prepared.identity },
        lastNow: now(),
        metrics,
        resolution: prepared.resolution,
        spyglass,
        spyglassAttachment
      };
    } catch (error) {
      // A failed half-install owns nothing that survives this acquire.
      spyglass?.dispose();
      group?.removeFromParent();
      throw error;
    }
  };

  const createLease = (slot: ExplorerSlot, identity: ExplorationSessionIdentity) => {
    let leaseDisposed = false;
    const currentExplorer = () => (slot.disposed ? null : slot.explorer);
    const update = (appearance: ExplorationAppearanceFrame | null) => {
      if (leaseDisposed || disposed || slot.disposed) return;
      const explorer = slot.explorer;
      if (!explorer) return;
      explorer.appearance = copyAppearance(appearance);
      applyExplorerAppearance(explorer, appearance);
    };
    const lease: ExplorationAppearanceLeaseHandle = {
      descriptor: () => currentExplorer()?.resolution ?? null,
      dispose: () => {
        if (leaseDisposed) return;
        leaseDisposed = true;
        if (active === slot) {
          active = null;
          refreshRequest++;
        }
        slot.disposed = true;
        const explorer = slot.explorer;
        slot.explorer = null;
        if (explorer) disposeExplorer(explorer);
      },
      eyeHeight: () => currentExplorer()?.metrics.eyeHeight ?? 0,
      identity: { ...identity },
      update
    };
    return lease;
  };

  const refreshActive = async () => {
    const slot = active;
    if (disposed || !slot || slot.disposed || !slot.explorer) return;
    const previous = slot.explorer;
    const token = ++refreshRequest;
    pending++;
    let prepared: PreparedExplorer | null = null;
    try {
      prepared = await prepareExplorer(slot.identity);
      if (disposed || slot.disposed || active !== slot || token !== refreshRequest) {
        const late = prepared;
        prepared = null;
        late.body.dispose();
        return;
      }
      const replacement = installExplorer(prepared);
      prepared = null;
      const appearance = previous.appearance;
      slot.explorer = replacement;
      try {
        if (appearance) applyExplorerAppearance(replacement, appearance);
      } catch (error) {
        slot.explorer = previous;
        disposeExplorer(replacement);
        throw error;
      }
      disposeExplorer(previous);
    } catch (error) {
      prepared?.body.dispose();
      if (disposed || active !== slot || slot.disposed) return;
      if (options.onRefreshError) {
        options.onRefreshError(error);
        return;
      }
      console.warn("Exploration appearance could not be refreshed after the crowd changed", error);
    } finally {
      pending--;
    }
  };

  const acquire = async (identity: ExplorationSessionIdentity): Promise<ExplorationAppearanceLeaseHandle> => {
    if (disposed) throw new Error("Exploration appearance adapter disposed");
    if (options.isCurrentIdentity && !options.isCurrentIdentity(identity))
      throw new Error("Stale exploration appearance identity");
    const token = ++request;
    pending++;
    let prepared: PreparedExplorer | null = null;
    try {
      prepared = await prepareExplorer(identity);
      if (disposed || token !== request ||
        (options.isCurrentIdentity && !options.isCurrentIdentity(identity))) {
        prepared.body.dispose();
        prepared = null;
        if (disposed) disposeLoader();
        throw new Error(disposed ? "Exploration appearance adapter disposed during load"
          : "Stale exploration appearance load released");
      }

      const explorer = installExplorer(prepared);
      prepared = null;
      // One transient body only: a replacement generation cannot leave a duplicate standing around.
      removeActive();
      const slot: ExplorerSlot = { disposed: false, explorer, identity: { ...identity } };
      active = slot;
      return createLease(slot, identity);
    } catch (error) {
      prepared?.body.dispose();
      throw error;
    } finally {
      pending--;
      if (disposed) disposeLoader();
    }
  };

  const unsubscribeSource = options.loader.onSourceChange?.(() => { void refreshActive(); });

  return {
    acquire,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      request++;
      removeActive();
      unsubscribeSource?.();
      disposeLoader();
    },
    stats: () => ({ active: active?.explorer != null, disposed, pending })
  };
};

export interface ExplorationAppearanceAdapterIntegration {
  /** Convenience for 01G: build the explorer-only loader and adapter in one step. */
  loader: ExplorationBodyLoader;
  adapter: ExplorationAppearanceAdapterHandle;
}

export const createOwnedExplorationAppearanceAdapter = (
  textures: KTX2Loader,
  options: Omit<ExplorationAppearanceAdapterOptions, "loader">
): ExplorationAppearanceAdapterIntegration => {
  const loader = createOwnedExplorationBodyLoader(textures);
  return { adapter: createExplorationAppearanceAdapter({ ...options, loader }), loader };
};
