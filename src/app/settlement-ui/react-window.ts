import { translateMessage } from "../../shared/i18n/translate";
import { createLazyReactContent, type LazyContentTexts, type MountWindowContent } from "../components/lazy-react-content";
import { createExternalStore, type ExternalStore } from "../components/ui-store";
import { createWindowFrame, type WindowFrameOptions } from "../components/window/window-frame-controller";
import { languagePreference } from "../localization/language-store";
import { SETTLEMENT_MESSAGES as M } from "./messages";

/** Whether the window is shown, and how many times it was opened (resets per-open state such as status). */
export interface SettlementWindowVisibility {
  opened: number;
  visible: boolean;
}

export type SettlementWindowVisibilityStore = ExternalStore<SettlementWindowVisibility>;

const getLazyTexts = (): LazyContentTexts => ({
  error: name => translateMessage(languagePreference.i18n, M.common.loadFailed, { name }),
  loading: name => translateMessage(languagePreference.i18n, M.common.loading, { name })
});

export interface ReactSettlementWindowOptions extends Pick<WindowFrameOptions, "className" | "data" | "heading" | "id"> {
  contentClassName: string;
  /** Loads the React content on the first open; it receives the visibility store and the close action. */
  load: (visibility: SettlementWindowVisibilityStore, close: () => void) => Promise<MountWindowContent>;
  /** Runs after the frame hid (close button, Escape, `close()`), e.g. to stop a view-owned preview. */
  onClose?: () => void;
}

/**
 * A settlement window: the shared React frame (`createWindowFrame`) owns visibility, drag and z-order; the
 * content mounts lazily on the first open so React stays out of the startup chunk, and reads the settlement
 * UI store only while the window is visible.
 */
export const createReactSettlementWindow = ({
  className, contentClassName, data, heading, id, load, onClose
}: ReactSettlementWindowOptions) => {
  const content = document.createElement("div");
  content.className = contentClassName;
  const visibility = createExternalStore<SettlementWindowVisibility>({ opened: 0, visible: false });
  const hide = () => {
    const { opened, visible } = visibility.getSnapshot();
    if (visible) visibility.set({ opened, visible: false });
    onClose?.();
  };
  const frame = createWindowFrame({ className, content, data, heading, id, onClose: hide });
  const lazyContent = createLazyReactContent(content, heading, () => load(visibility, frame.close), getLazyTexts());
  return {
    ...frame,
    /** The opening count the next `open()` gives (opener tokens name it). */
    nextOpening: () => visibility.getSnapshot().opened + 1,
    open: () => {
      frame.open();
      visibility.set({ opened: visibility.getSnapshot().opened + 1, visible: true });
      lazyContent.mount();
    },
    dispose: () => {
      lazyContent.unmount();
      frame.dispose();
    }
  };
};
