import { stoneLanternParts } from "../japanese-stone-lantern";
import type { LevelKit } from "./level-kit";
import { findYardSpot } from "./level-yard-props";

/**
 * Free-standing yard alternative where no wall has room (mine portals, towers at their plot
 * edge): a lantern post (levels 2-4) on open ground against a wall.
 */
/** Posts stand out from the wall far enough to clear the eaves above them. */
const POLE_STANDOFFS = [.05, .15, .3, .45];
const LANTERN_POST = { height: .72, lamp: .12, size: [.16, .82, .16] as [number, number, number] } as const;

/** Lantern post: a timber post with a glazed lamp under a cap (Japanese: a stone tōrō). */
export const addLanternPost = (kit: LevelKit) => {
  const spot = findYardSpot(kit, LANTERN_POST.size, POLE_STANDOFFS);
  if (!spot) return;
  const [x, , z] = spot.at;
  if (kit.site.nation === "japanese") {
    for (const part of stoneLanternParts(x, z, kit.detailed)) kit.add({ stage: 3, ...part });
    return;
  }
  const { height, lamp } = LANTERN_POST;
  kit.add({ position: [x, height / 2, z], shape: kit.detailed ? "bevel-box" : "box", size: [.05, height, .05],
    surface: "wood" });
  kit.add({ position: [x, height + lamp / 2, z], shape: "box", size: [.08, lamp, .08], surface: "amber",
    nightLamp: true });
  kit.add({ position: [x, height + lamp + .025, z], radialSegments: 4, rotation: [0, Math.PI / 4, 0], shape: "cone",
    size: [.12, .06, .12], surface: "iron" });
};
