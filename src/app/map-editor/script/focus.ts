/** A ref callback that focuses its element once it is mounted (dialog search, inline editors). */
export const focusOnMount = (element: HTMLElement | null) => {
  element?.focus();
};

/** A ref callback that scrolls its element into view once mounted when `wanted` (the item a deep link names). */
export const scrollIntoViewWhen = (wanted: boolean) => (element: HTMLElement | null) => {
  if (wanted) element?.scrollIntoView?.({ block: "nearest" });
};
