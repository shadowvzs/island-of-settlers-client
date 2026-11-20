import {
  BoxGeometry, DataTexture, Material, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Texture,
  type WebGLRenderer
} from "three";

type DisposeListener = (event: object) => void;
/** The structural part of three's EventDispatcher this module patches and calls. */
interface Dispatcher {
  addEventListener(type: string, listener: DisposeListener): void;
  removeEventListener(type: string, listener: DisposeListener): void;
}

/** Targets that received a watched renderer-internal disposer (weak: a dropped target may be collected). */
const watched = new WeakMap<DisposeListener, Set<WeakRef<Dispatcher>>>();
let installed = false;

/**
 * three.js adds an internal "dispose" listener to every material it compiles and every texture it
 * uploads; the material one closes over the whole WebGLRenderer. `renderer.dispose()` leaves those
 * listeners on materials/textures that outlive it (page-lifetime caches shared across islands), so
 * each replaced island stayed reachable with its scene and world (GPU-LIFECYCLE-03: ~23 MB per
 * handoff). Records which objects receive a watched disposer; only watched functions are stored.
 */
const installRecorder = () => {
  if (installed) return;
  installed = true;
  for (const prototype of [Material.prototype, Texture.prototype] as unknown as Dispatcher[]) {
    const add = prototype.addEventListener;
    prototype.addEventListener = function(this: Dispatcher, type: string, listener: DisposeListener) {
      if (type === "dispose") watched.get(listener)?.add(new WeakRef(this));
      return add.call(this, type, listener);
    };
  }
};

const disposeListenerOf = (target: object): DisposeListener | undefined =>
  (target as { _listeners?: { dispose?: DisposeListener[] } })._listeners?.dispose?.[0];

/** This renderer's internal material/texture disposers, read from one throwaway compile and upload. */
const captureRendererDisposers = (renderer: WebGLRenderer) => {
  const material = new MeshBasicMaterial();
  const geometry = new BoxGeometry();
  const scene = new Scene().add(new Mesh(geometry, material));
  renderer.compile(scene, new PerspectiveCamera());
  const texture = new DataTexture(new Uint8Array(4), 1, 1);
  texture.needsUpdate = true;
  renderer.initTexture(texture);
  const disposers = [disposeListenerOf(material), disposeListenerOf(texture)]
    .filter((listener): listener is DisposeListener => Boolean(listener));
  material.dispose(); texture.dispose(); geometry.dispose();
  return disposers;
};

/** Starts watching the given renderer-internal disposers (exported for the unit test). */
export const watchDisposeListeners = (listeners: readonly DisposeListener[]) => {
  installRecorder();
  for (const listener of listeners) if (!watched.has(listener)) watched.set(listener, new Set());
  return () => {
    for (const listener of listeners) {
      for (const reference of watched.get(listener) ?? []) reference.deref()?.removeEventListener("dispose", listener);
      watched.delete(listener);
    }
  };
};

/**
 * Call right after creating the renderer; the returned release runs before `renderer.dispose()` and
 * detaches the renderer from every surviving shared material/texture. Their pixels, programs of
 * other renderers and app-level dispose listeners are untouched (borrowed resources stay intact).
 */
export const trackRendererSharedListeners = (renderer: WebGLRenderer) => {
  installRecorder();
  return watchDisposeListeners(captureRendererDisposers(renderer));
};
