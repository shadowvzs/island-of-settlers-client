import type { WorkerNation } from "../render-common/workers/worker-unit";

/** Exposed water only, in source-image percentages; leave people, ships and shores undisturbed. */
const WATER_PATHS: Record<WorkerNation, string> = {
  maya: "M1 51 L17 51 L15 58 L1 65 Z " +
    "M62 52 L100 52 L100 81 L88 75 L73 65 L62 61 Z",
  persian: "M14 47 L20 47 L18 56 L14 58 Z " +
    "M62 50 L100 50 L100 80 L88 74 L73 63 L62 60 Z",
  chinese: "M13 46 L19 46 L18 54 L13 58 Z " +
    "M52 49 L100 49 L100 82 L86 75 L68 66 L64 65 L64 60 L52 57 Z",
  indigenous: "M1 51 L16 51 L14 61 L1 68 Z " +
    "M62 52 L100 52 L100 86 L88 76 L75 65 L62 61 Z",
  japanese: "M8 47 L22 48 L28 51 L29 55 L27 58 L21 63 L9 69 Z " +
    "M58 54 L92 54 L91 64 L88 68 L88 78 L70 69 L62 64 Z",
  nubian: "M8 47 L21 48 L30 50 L31 53 L28 57 L21 63 L8 72 Z " +
    "M58 55 L100 54 L100 85 L91 80 L75 71 L62 64 Z",
  roman: "M0 45 L19 47 L26 50 L26 54 L24 58 L18 63 L0 76 Z " +
    "M58 55 L100 53 L100 85 L94 81 L74 70 L62 64 Z",
  viking: "M0 47 L18 48 L28 51 L28 55 L25 59 L16 65 L0 74 Z " +
    "M58 56 L100 55 L100 86 L91 81 L75 72 L62 65 Z"
};

/** Ship and passenger silhouettes; the island and sky remain on the stationary base image. */
const FOREGROUND_PATHS: Record<WorkerNation, string> = {
  maya: "M0 82 L16 71 L28 67 L39 67 L51 70 L64 78 L81 93 L86 100 L0 100 Z",
  persian: "M0 82 L16 73 L27 69 L39 69 L51 71 L66 79 L86 95 L90 100 L0 100 Z",
  chinese: "M0 83 L16 76 L28 73 L40 75 L53 77 L69 85 L89 98 L92 100 L0 100 Z",
  indigenous: "M0 88 L15 77 L27 72 L39 72 L51 74 L66 82 L83 97 L85 100 L0 100 Z",
  roman: "M0 79 L15 65 L20 64 L24 59 L29 55 L35 59 L49 59 L56 63 L60 64 L64 67 " +
    "L100 94 L100 100 L0 100 Z " +
    "M39 19 Q42 16 45 18 L45 21 L43 24 L46 26 L46 33 L45 36 L49 38 " +
    "L51 43 L54 50 L55 56 L58 61 L56 63 L52 60 L49 55 L48 81 L35 91 " +
    "L28 85 L28 78 L31 65 L31 61 L28 62 L28 60 L31 57 L34 52 L35 43 " +
    "L38 39 L41 36 L40 33 L39 28 L39 25 Z " +
    "M27 45 L27 42 L25 39 L24 36 L25 32 L28 30 L29 28 L31 28 L32 30 " +
    "L35 31 L37 39 L35 40 L33 37 L33 41 L32 44 L34 49 L31 55 L27 56 Z",
  japanese: "M0 73 L15 64 L18 61 L20 61 L20 59 L23 58 L27 54 L30 54 " +
    "L30 48 L33 47 L34 56 L37 60 L52 61 L58 63 L59 60 L62 60 L64 64 " +
    "L85 79 L87 78 L89 78 L91 81 L100 86 L100 100 L0 100 Z " +
    "M37 19 L40 21 L40 25 L43 25 L44 21 L46 19 L45 25 L46 29 L47 33 " +
    "L46 35 L49 36 L51 41 L52 46 L51 50 L53 55 L54 59 L57 61 L56 64 " +
    "L53 63 L49 58 L48 77 L49 98 L35 100 L36 79 L34 63 L33 60 L33 56 " +
    "L32 52 L32 48 L33 41 L35 36 L38 34 L38 29 L39 26 Z",
  nubian: "M0 77 L13 65 L16 63 L18 63 L20 64 L28 57 L28 51 L30 49 " +
    "L32 50 L32 57 L36 60 L50 59 L57 64 L59 65 L60 63 L62 65 L63 70 " +
    "L81 85 L83 81 L88 78 L93 83 L95 89 L100 94 L100 100 L0 100 Z " +
    "M40 23 Q43 21 44 25 L44 30 L43 33 L45 35 L47 36 L49 40 L50 47 " +
    "L52 54 L54 58 L56 60 L56 63 L52 62 L48 57 L47 77 L49 98 L34 100 " +
    "L35 78 L34 65 L32 61 L32 53 L33 44 L35 38 L39 34 L40 32 L39 28 Z",
  viking: "M0 78 L7 70 L12 68 L18 63 L23 60 L25 57 L28 57 L31 61 L49 61 " +
    "L56 65 L58 66 L60 65 L62 67 L67 72 L70 79 L76 85 L79 80 L85 79 " +
    "L90 89 L100 100 L0 100 Z " +
    "M39 26 Q41 23 44 26 L44 32 L44 35 L47 36 L49 39 L50 44 L49 49 " +
    "L51 55 L54 60 L56 62 L55 65 L51 64 L48 59 L47 76 L47 100 L34 100 " +
    "L35 82 L25 80 L24 77 L27 67 L30 58 L27 61 L26 60 L27 58 L29 56 " +
    "L31 50 L31 43 L33 37 L37 34 L39 32 Z"
};

const featheredMask = (path: string, feather: number) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">' +
    '<defs><filter id="edge" x="-10%" y="-10%" width="120%" height="120%">' +
    `<feGaussianBlur stdDeviation="${feather}"/></filter></defs>` +
    `<path fill="white" filter="url(#edge)" d="${path}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};

/** A small static feathered mask; all motion uses transforms of the existing cached WebP. */
export const loadingVoyageMotion = (nation: WorkerNation) => {
  let aspect = 1672 / 941;
  if (nation === "roman" || nation === "japanese") aspect = 1600 / 900;
  return { aspect: String(aspect), foreground: featheredMask(FOREGROUND_PATHS[nation], .22),
    mask: featheredMask(WATER_PATHS[nation], .6) };
};
