import "./window-layer.css";

const layers = new WeakMap<HTMLElement, HTMLElement>();

/** One stacking context for scene windows, HUD controls and modal confirmations. */
export const getWindowLayer = (container: HTMLElement) => {
  if (container.classList.contains("app-window-layer")) return container;
  const existing = layers.get(container);
  if (existing?.parentElement === container) return existing;
  const layer = document.createElement("div");
  layer.className = "app-window-layer";
  container.append(layer);
  layers.set(container, layer);
  return layer;
};

/**
 * Appends a window root to the container's window layer, inside a `layerClassName` wrapper when given (a
 * scoped stylesheet or stacking context); returns the appended element.
 */
export const appendToLayer = (container: HTMLElement, root: HTMLElement, layerClassName?: string) => {
  const layer = getWindowLayer(container);
  if (!layerClassName) {
    layer.append(root);
    return root;
  }
  const wrapper = document.createElement("div");
  wrapper.className = layerClassName;
  wrapper.append(root);
  layer.append(wrapper);
  return wrapper;
};

const POINTER_EVENTS = ["pointerdown", "pointerup", "wheel", "click"] as const;

const stopPropagation = (event: Event) => event.stopPropagation();

/** Clicks and drags on a panel must not pan the camera or fell trees behind it. */
export const isolatePointer = (
  element: HTMLElement,
  events: readonly string[] = POINTER_EVENTS,
  signal?: AbortSignal
) => {
  for (const type of events) element.addEventListener(type, stopPropagation, { signal });
};
