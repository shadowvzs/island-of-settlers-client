import type { WorkerNation } from "../render-common/workers/worker-unit";
import cloud from "./assets/loading-cloud.webp";
import smoke from "./assets/loading-smoke.webp";

// Source-art percentages. Only the Viking illustration has clearly painted working chimneys.
const CHIMNEYS: readonly [number, number][] = [[68.9, 39.1], [77.4, 37.8]];

/** Two small shared textures and CSS-only motion; no timers, canvas, shaders or game-state work. */
export const setLoadingAtmosphere = (art: HTMLElement, nation: WorkerNation) => {
  let layer = art.querySelector<HTMLElement>(".loading-screen__atmosphere");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "loading-screen__atmosphere";
    layer.setAttribute("aria-hidden", "true");
    art.querySelector(".loading-screen__sea")?.before(layer);
  }
  layer.replaceChildren();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const sprite = (source: string, className: string) => {
    const image = document.createElement("img");
    image.alt = ""; image.draggable = false; image.decoding = "async"; image.fetchPriority = "low";
    image.className = className; image.src = source;
    layer.append(image); return image;
  };
  for (let index = 0; index < 2; index++)
    sprite(cloud, `loading-screen__cloud loading-screen__cloud--${index}`);
  if (nation !== "viking") return;
  for (const [index, [x, y]] of CHIMNEYS.entries()) for (let puff = 0; puff < 2; puff++) {
    const image = sprite(smoke, "loading-screen__smoke");
    image.style.left = `${x}%`; image.style.top = `${y}%`;
    image.style.animationDelay = `${-puff * 3 - index}s`;
  }
};
