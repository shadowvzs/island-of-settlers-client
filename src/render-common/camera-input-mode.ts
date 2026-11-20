/**
 * While the army's "Box select" mode is on, a left (or one-finger) drag box-selects
 * soldiers instead of panning; panning stays on right / middle drag, the screen edges, the keys
 * and the two-finger pinch.
 */
let primaryDragSelects = false;
/** Shift + left drag box-selects soldiers (military controls §5.1) while this answers true. */
let shiftDragSelects: () => boolean = () => false;

export const setPrimaryDragSelects = (value: boolean) => { primaryDragSelects = value; };

export const isPrimaryDragSelecting = () => primaryDragSelects;

/** The settlement's soldier controls own Shift + left drag while they are active; null releases it. */
export const setShiftDragSelects = (active: (() => boolean) | null) => {
  shiftDragSelects = active ?? (() => false);
};

/** A left press with Shift draws the soldier box instead of panning. */
export const isShiftDragSelecting = (event: Pick<PointerEvent, "button" | "shiftKey">) =>
  event.button === 0 && event.shiftKey && shiftDragSelects();
