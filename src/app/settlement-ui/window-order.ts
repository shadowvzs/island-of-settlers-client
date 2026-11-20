/** Bounded stacking order shared by independently opened settlement windows. */
const windows: HTMLElement[] = [];

export const registerSettlementWindowOrder = (panel: HTMLElement, signal: AbortSignal) => {
  windows.push(panel);
  const activate = () => {
    if (panel.hidden) return;
    const index = windows.indexOf(panel);
    if (index < 0) return;
    windows.splice(index, 1);
    windows.push(panel);
    windows.forEach((window, order) => {
      window.style.zIndex = String(5 + order);
    });
  };
  panel.addEventListener("pointerdown", activate, { capture: true, signal });
  panel.addEventListener("wheel", activate, { passive: true, signal });
  panel.addEventListener("focusin", activate, { signal });
  signal.addEventListener("abort", () => {
    const index = windows.indexOf(panel);
    if (index >= 0) windows.splice(index, 1);
  }, { once: true });
  return activate;
};
