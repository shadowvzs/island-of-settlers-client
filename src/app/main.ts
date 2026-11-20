import { showLoadingFailure } from "./loading-screen";

/** Longest wait for the loading art before the boot graphs download anyway (a slow or missing image). */
const LOADING_ART_WAIT_MS = 1000;

/** Resolves once the loading art has loaded (or failed, or the wait ran out). */
const loadingArtSettled = () => new Promise<void>(resolve => {
  const image = document.querySelector<HTMLImageElement>(".loading-screen__image");
  if (!image?.getAttribute("src") || image.complete) {
    resolve();
    return;
  }
  const done = () => {
    clearTimeout(timer);
    image.removeEventListener("load", done);
    image.removeEventListener("error", done);
    resolve();
  };
  const timer = setTimeout(done, LOADING_ART_WAIT_MS);
  image.addEventListener("load", done);
  image.addEventListener("error", done);
});

/**
 * The player entry stays small: with the loading art (`loading-art-startup.ts`, bundled into this entry)
 * it paints first. Downloads are ordered by need so they do not share the bandwidth: the art, then the
 * boot session (language, sign-in, title page), then the island graph (`game-boot`), which downloads
 * behind the shown title page (or at once without one); the island starts once the title page is done.
 */
const startPlayerPage = async () => {
  await loadingArtSettled();
  const { startBootSession } = await import("./session-boot");
  let islandBoot: Promise<typeof import("./game-boot")> | undefined;
  const loadIslandBoot = () => (islandBoot ??= import("./game-boot"));
  const session = await startBootSession({
    // A prefetch failure is reported when the island graph is used below.
    prefetchIsland: () => { loadIslandBoot().catch(() => undefined); }
  });
  if (!session) return;
  await (await loadIslandBoot()).startIsland(session);
};

void startPlayerPage().catch(showLoadingFailure);
