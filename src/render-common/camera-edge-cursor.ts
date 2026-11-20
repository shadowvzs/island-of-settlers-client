const cursors = new Map<string, string>();
for (const [x, y, fallback] of [
  [-1, -1, "nw-resize"], [0, -1, "n-resize"], [1, -1, "ne-resize"],
  [-1, 0, "w-resize"], [1, 0, "e-resize"],
  [-1, 1, "sw-resize"], [0, 1, "s-resize"], [1, 1, "se-resize"]
] as const) {
  const angle = Math.atan2(x, -y) * 180 / Math.PI;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <defs><linearGradient id="gold" x2="1" y2="1"><stop stop-color="#fff3bd"/>
    <stop offset=".55" stop-color="#e5b85f"/><stop offset="1" stop-color="#9c682c"/></linearGradient></defs>
    <path transform="rotate(${angle} 16 16)" d="M16 3 27 15H21V28H11V15H5Z"
      fill="url(#gold)" stroke="#382719" stroke-width="2" stroke-linejoin="round"/>
    </svg>`;
  cursors.set(`${x}/${y}`, `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, ${fallback}`);
}

/** Scoped to the map surface, so menus retain their own pointers and editing cursors return. */
export const createCameraEdgeCursor = (surface: HTMLElement) => {
  let applied = "", previous = "", requested = "";
  const clear = () => {
    if (!applied) return;
    if (surface.style.cursor === applied) surface.style.cursor = previous;
    applied = ""; requested = "";
  };
  return {
    clear,
    update: (direction: { x: number; y: number } | null) => {
      const cursor = direction && cursors.get(`${direction.x}/${direction.y}`);
      if (!cursor) { clear(); return; }
      if (cursor === requested) return;
      if (!applied || surface.style.cursor !== applied) previous = surface.style.cursor;
      // Important, so the edge zone also beats order cursors set by stylesheet (army-order-cursor.css).
      surface.style.setProperty("cursor", cursor, "important");
      applied = surface.style.cursor; requested = cursor;
    }
  };
};
