import type { AdventureTheme } from "../../shared/settlement/adventure-themes";
import type { BanditSiteRef } from "./bandit-camp-plan";
import type { BuildingSurface } from "./building-recipe";

export interface EnemyBuildingStyle {
  /** A bandit site compound in world units (its own camp recipe); absent: a themed military building. */
  bandit?: BanditSiteRef;
  enclosure?: "building";
  breachedWalls?: readonly number[];
  theme: AdventureTheme;
  variant?: "bandit" | "pirate";
  /** Geometry variant of a themed military building (`stableEnemyModel`); unused by bandit sites. */
  model?: 0 | 1 | 2;
}
/** A saved building ID selects geometry, independent of load order, quality or wall-clock time. */
export const stableEnemyModel = (id: string): 0 | 1 | 2 => {
  let hash = 0;
  for (const character of id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return (hash % 3) as 0 | 1 | 2;
};
export interface EnemyBuildingDesign {
  walls: BuildingSurface;
  roof: BuildingSurface;
  profile: "half-hip" | "hip" | "gable" | "barrel";
  timber: "rounded" | "buttress" | "braced";
  lashings: boolean;
  snow: boolean;
  nautical?: boolean;
  colours: Partial<Record<BuildingSurface, number>>;
}
const DESIGNS: Record<AdventureTheme, EnemyBuildingDesign> = {
  forest: {
    walls: "planks",
    roof: "roof-thatch",
    profile: "half-hip",
    timber: "braced",
    lashings: false,
    snow: false,
    colours: {
      wood: 0x8e806a,
      planks: 0xb9ad91,
      stone: 0xbcb9a1,
      cloth: 0x63734c,
      "roof-thatch": 0xc6b88c
    }
  },
  tropical: {
    walls: "planks",
    roof: "roof-thatch",
    profile: "hip",
    timber: "rounded",
    lashings: true,
    snow: false,
    colours: {
      wood: 0xc2b08c,
      planks: 0xc9bba2,
      stone: 0xd1c4a5,
      cloth: 0x48888c,
      "roof-thatch": 0xadab7e
    }
  },
  winter: {
    walls: "planks",
    roof: "roof-shingles",
    profile: "gable",
    timber: "rounded",
    lashings: false,
    snow: true,
    colours: {
      wood: 0x8c8a82,
      planks: 0xb5b5ac,
      stone: 0xc2c4c3,
      plaster: 0xe4e8e8,
      cloth: 0x657888,
      "roof-shingles": 0xa6a9a3
    }
  },
  desert: {
    walls: "plaster",
    roof: "cloth",
    profile: "barrel",
    timber: "buttress",
    lashings: false,
    snow: false,
    colours: {
      wood: 0xb2a28a,
      planks: 0xd3c1a3,
      stone: 0xd9c8a4,
      plaster: 0xd4b987,
      cloth: 0xd9c89e
    }
  },
  swamp: {
    walls: "planks",
    roof: "roof-shingles",
    profile: "half-hip",
    timber: "braced",
    lashings: true,
    snow: false,
    colours: {
      wood: 0x777c67,
      planks: 0x99a38c,
      stone: 0x9daba0,
      cloth: 0x78805c,
      "roof-shingles": 0x858d76
    }
  }
};
const PIRATE: EnemyBuildingDesign = {
  walls: "planks",
  roof: "roof-shingles",
  profile: "barrel",
  timber: "braced",
  lashings: true,
  snow: false,
  nautical: true,
  colours: {
    wood: 0x7a807d,
    planks: 0xb0b7b2,
    stone: 0xbcb9aa,
    cloth: 0x4d7e87,
    iron: 0x79807e,
    "roof-shingles": 0x939a97
  }
};
/** A tropical coast can use the nautical timber kit; all other climates ignore a pirate request. */
export const enemyBuildingDesign = (style: EnemyBuildingStyle): EnemyBuildingDesign =>
  style.theme === "tropical" && style.variant === "pirate" ? PIRATE : DESIGNS[style.theme];
export const enemyBuildingStyleKey = (style: EnemyBuildingStyle) =>
  `${style.theme}:${style.theme === "tropical" && style.variant === "pirate" ? "pirate" : "bandit"}`;
