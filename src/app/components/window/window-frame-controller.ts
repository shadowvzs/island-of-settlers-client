import type { DataAttributes } from "../labelled-button";
import { createExternalStore, type ReadableStore } from "../ui-store";
import { createReactHost } from "./helpers";

/** What the frame shows: the title (and optional live name), visibility and how often it was opened. */
export interface WindowFrameState {
  /** Lower-case window name for the drag/close labels, when it follows a translated title. */
  name?: string;
  opened: number;
  title: string;
  visible: boolean;
}

/** Everything a frame mounter renders from (the React frame reads the state store). */
export interface WindowFrameMountProps {
  className: string;
  /** DOM content below the header (it has its own lazily mounted React root). */
  content?: HTMLElement;
  data?: DataAttributes;
  id: string;
  name: string;
  state: ReadableStore<WindowFrameState>;
  onClose: () => void;
  onOpened?: () => void;
}

/** Renders a window frame into its host; returns the unmount. */
export type MountWindowFrame = (host: HTMLElement, props: WindowFrameMountProps) => () => void;

export interface WindowFrameOptions {
  /** Classes besides `settlement-ui__panel`. */
  className: string;
  content?: HTMLElement;
  /** `data-*` attributes of the frame (selectors of drivers and tests). */
  data?: DataAttributes;
  heading: string;
  id: string;
  /** The frame's React mounter (loaded on the first open); the shared frame around `content` by default. */
  load?: () => Promise<MountWindowFrame>;
  /** After the frame hid (close button, Escape, `close()`). */
  onClose?: () => void;
  /** After each opening was shown and focused. */
  onOpened?: () => void;
  /** Shown from the start, without the open effects (focus, raise). */
  visible?: boolean;
}

const loadSharedFrame = async () => (await import("./mount-window-frame")).mountWindowFrame;

/**
 * A movable window: this React-free controller owns visibility, title and the open count; the React frame
 * (drag, z-order, header) loads with its root on the first `open` or `mount`, so React stays out of the startup
 * chunk. `root` is the `display: contents` host the owner places where the frame belongs.
 */
export const createWindowFrame = ({
  className, content, data, heading, id, load = loadSharedFrame, onClose, onOpened, visible = false
}: WindowFrameOptions) => {
  const root = createReactHost();
  const state = createExternalStore<WindowFrameState>({ opened: 0, title: heading, visible });
  const patch = (changes: Partial<WindowFrameState>) => state.set({ ...state.getSnapshot(), ...changes });
  let loading: Promise<void> | undefined;
  let unmount: (() => void) | undefined;
  let disposed = false;
  const hide = () => {
    if (state.getSnapshot().visible) patch({ visible: false });
  };
  const close = () => {
    hide();
    onClose?.();
  };
  const props: WindowFrameMountProps = {
    className, content, data, id, name: heading.toLowerCase(), state, onClose: close, onOpened
  };
  const mountFrame = async () => {
    try {
      const mountWindow = await load();
      if (!disposed) unmount = mountWindow(root, props);
    } catch (error) {
      loading = undefined;
      console.error(`${heading} window could not load`, error);
    }
  };
  /** Loads and renders the frame once (a failed load retries on the next call). */
  const mount = () => { loading ??= mountFrame(); };
  return {
    close,
    /** Whether the node lies inside this window. */
    contains: (node: Node) => root.contains(node),
    /** Hides without the close callback (an owner policy that already ran its close rules). */
    hide,
    isOpen: () => state.getSnapshot().visible,
    mount,
    open: () => {
      patch({ opened: state.getSnapshot().opened + 1, visible: true });
      mount();
    },
    root,
    setName: (name: string) => {
      if (state.getSnapshot().name !== name) patch({ name });
    },
    setTitle: (title: string) => {
      if (state.getSnapshot().title !== title) patch({ title });
    },
    dispose: () => {
      disposed = true;
      unmount?.();
      root.remove();
    }
  };
};
