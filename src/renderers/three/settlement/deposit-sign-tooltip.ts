/** Lightweight map tooltip: renderer-owned pointer feedback, disposed with its canvas listeners. */
export const createDepositSignTooltip = (canvas: HTMLCanvasElement) => {
  const element = document.createElement("div");
  element.className = "deposit-sign-tooltip";
  element.setAttribute("role", "tooltip");
  element.hidden = true;
  canvas.parentElement?.append(element);
  return {
    hide: () => { element.hidden = true; },
    show: (label: string, clientX: number, clientY: number) => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const bounds = parent.getBoundingClientRect();
      element.textContent = label;
      element.hidden = false;
      const x = Math.max(0, Math.min(parent.clientWidth - element.offsetWidth, clientX - bounds.left + 14));
      const y = Math.max(0, Math.min(parent.clientHeight - element.offsetHeight, clientY - bounds.top + 14));
      element.style.transform = `translate(${x}px, ${y}px)`;
    },
    dispose: () => element.remove()
  };
};
