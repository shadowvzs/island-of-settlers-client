import { mountReactIsland } from "../../components/react-island";
import type { HighlightStore } from "./highlight-store";
import { type HighlightItem, useHighlightLayer } from "./use-highlight-layer";

import "./highlight-layer.css";

interface HighlightMarkProps {
  item: HighlightItem;
  nodeRef: (node: HTMLElement | null) => void;
}
const HighlightMark = ({ item, nodeRef }: HighlightMarkProps) => (
  <div className="script-highlight" data-effect-id={item.effectId} hidden ref={nodeRef}>
    <div className="script-highlight__ring" />
    {item.text && <div className="script-highlight__bubble" role="status">{item.text}</div>}
  </div>
);

interface HighlightLayerProps {
  highlights: HighlightStore;
}
/** Tutorial pointers of the map script: a pulsing ring and an optional hint over `data-ui-anchor` controls. */
export const HighlightLayer = ({ highlights }: HighlightLayerProps) => {
  const { bind, items } = useHighlightLayer(highlights);
  return (
    <div aria-live="polite" className="script-highlight-layer">
      {items.map(item => <HighlightMark item={item} key={item.effectId} nodeRef={bind(item.effectId)} />)}
    </div>
  );
};

/** Mounts the overlay above the HUD (pointer-transparent); returns the unmount. */
export const mountHighlightLayer = (host: HTMLElement, highlights: HighlightStore) =>
  mountReactIsland(host, <HighlightLayer highlights={highlights} />);
