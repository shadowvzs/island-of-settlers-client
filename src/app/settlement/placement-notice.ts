import type { PlacementSelection } from "./placement-controls";

const selectionKey = ({ building, road, survey }: PlacementSelection) => `${building}/${road}/${survey}`;

/**
 * A placement notice (no space for the selected building, a rejected plot, the next road
 * endpoint) is about the current selection only: once another building or tool is picked, or
 * placement ends, it is stale and the status clears, unless another message replaced it.
 */
export const createPlacementNotice = () => {
  let key = selectionKey({ building: null, road: null, rotation: 0, survey: null }), notice = "";
  return {
    told: (text: string) => { notice = text; },
    /** True when the selection changed while the shown status is still the earlier notice. */
    isStale: (selection: PlacementSelection, status: string) => {
      const next = selectionKey(selection);
      if (next === key) return false;
      key = next;
      const stale = notice !== "" && status === notice;
      notice = "";
      return stale;
    }
  };
};
