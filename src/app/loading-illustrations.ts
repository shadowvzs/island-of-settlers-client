import type { WorkerNation } from "../render-common/workers/worker-unit";
import roman from "./assets/island-voyage-1.webp";
import japanese from "./assets/island-voyage-2.webp";
import chinese from "./assets/island-voyage-chinese.webp";
import indigenous from "./assets/island-voyage-indigenous.webp";
import maya from "./assets/island-voyage-maya.webp";
import nubian from "./assets/island-voyage-nubian.webp";
import persian from "./assets/island-voyage-persian.webp";
import viking from "./assets/island-voyage-viking.webp";
import { setLoadingAtmosphere } from "./loading-atmosphere";
import { loadingVoyageMotion } from "./loading-voyage-motion";
import { rawTextCodec } from "./preferences/codecs";
import { PREFERENCES } from "./preferences/keys";
import { definePreference } from "./preferences/registry";

const loadingNation = definePreference(PREFERENCES.loadingNation, rawTextCodec);
/** The settings' worker nation (raw: the head entry stays free of the settings module). */
const settingsNation = definePreference(PREFERENCES.workerNation, rawTextCodec);
const LOADING_ILLUSTRATIONS: Record<WorkerNation, { url: string; alt: string }> = {
  maya: { url: maya, alt: "A Maya warrior sailing toward a tropical island city" },
  persian: { url: persian, alt: "A Persian warrior sailing toward an island settlement" },
  chinese: { url: chinese, alt: "A Chinese warrior sailing toward a mountainous island city" },
  indigenous: { url: indigenous, alt: "An Indigenous traveler sailing toward a forested island settlement" },
  roman: { url: roman, alt: "A legionary sailing toward a green, rocky island" },
  japanese: { url: japanese, alt: "A samurai sailing toward an island with a castle and cherry trees" },
  nubian: { url: nubian, alt: "A Nubian warrior sailing toward a sandstone island settlement with palms" },
  viking: { url: viking, alt: "A Viking warrior on a longship approaching a northern island settlement" }
};

export const readLoadingNation = (): WorkerNation => {
  const nation = loadingNation.read() ?? settingsNation.read();
  if (nation && Object.hasOwn(LOADING_ILLUSTRATIONS, nation)) return nation as WorkerNation;
  // Storage can be unavailable; the first voyage defaults to Roman.
  return "roman";
};

/** The head entry and the main loader share this, including protection against stale decodes. */
export const setLoadingNation = (root: HTMLElement, nation: WorkerNation) => {
  loadingNation.write(nation);
  const image = root.querySelector<HTMLImageElement>(".loading-screen__image");
  if (!image) return;
  const { alt, url } = LOADING_ILLUSTRATIONS[nation];
  image.dataset.nation = nation;
  image.fetchPriority = "high";
  const apply = () => {
    image.src = url; image.alt = alt;
    const art = root.querySelector<HTMLElement>(".loading-screen__art");
    const water = root.querySelector<HTMLImageElement>(".loading-screen__sea-image");
    const foreground = root.querySelector<HTMLImageElement>(".loading-screen__foreground-image");
    if (!art || !water) return;
    const motion = loadingVoyageMotion(nation);
    art.style.setProperty("--voyage-aspect", motion.aspect);
    if (nation === "maya") art.style.left = "calc(50% + max(0px, 55vh - 55vw))";
    else if (["chinese", "persian", "indigenous"].includes(nation))
      art.style.left = "calc(50% + max(0px, 42vh - 42vw))";
    else art.style.removeProperty("left");
    art.style.setProperty("--voyage-water-mask", motion.mask);
    art.style.setProperty("--voyage-foreground-mask", motion.foreground);
    art.dataset.nation = nation;
    setLoadingAtmosphere(art, nation);
    water.src = url;
    if (foreground) foreground.src = url;
  };
  if (!image.getAttribute("src") || image.src === new URL(url, location.href).href) { apply(); return; }
  const next = new Image();
  next.src = url;
  void next.decode().then(() => {
    if (image.dataset.nation === nation) apply();
    return undefined;
  }).catch(() => {});
};
