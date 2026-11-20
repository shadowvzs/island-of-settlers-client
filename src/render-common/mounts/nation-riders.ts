import type { WorkerNation } from "../workers/worker-unit";

/**
 * Each nation's cavalry body: a riding variant of one of the nation's foot soldier bodies, which
 * is also the armour body whose fitted "soldier" pieces the rider wears (mount-rider-armour.ts).
 */
export const NATION_RIDERS: Readonly<Record<WorkerNation, string>> = {
  maya: "roman-man-white",
  persian: "roman-man-white",
  chinese: "roman-man-white",
  indigenous: "roman-man-white",
  japanese: "japanese-man-linen",
  nubian: "nubian-man-kilt",
  roman: "roman-man-white",
  viking: "viking-woman-blue"
};
