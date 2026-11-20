import type { WorkerNation } from "../../workers/worker-unit";
import { buildingFamilyId } from "../building-triangle-budgets";
import type { LevelSite } from "./level-site";

/**
 * Level pieces a heavy model can do without: the level 3 string course (the raised walls and chimney
 * still show), the door hood (the roof piece still shows), the banner, a crown's secondary ornaments
 * (acroteria, shachihoko, weather vane) and yard props beyond one group on High (Minimal keeps none).
 */
export type LeanPiece = "band" | "banner" | "crown-ornaments" | "door-hood" | "yard-props";

type LeanSet = readonly LeanPiece[];
/** [High, Minimal] pieces left out per occupation family. */
type LeanTable = Readonly<Record<number, readonly [high: LeanSet, minimal: LeanSet]>>;

/**
 * Models whose full level 4-5 additions would pass the 15 % triangle budget tolerance
 * (building-level-budgets.test.ts measures every type, nation, level and detail). Each keeps a
 * visible change at every level: plinth and sign (2), band or chimney (3), roof piece (4), crown (5).
 */
const LEAN_MODELS: Readonly<Record<WorkerNation, LeanTable>> = {
  maya: {
    0: [["crown-ornaments", "yard-props"], []],
    5: [[], ["band", "crown-ornaments", "door-hood"]],
    15: [["crown-ornaments", "door-hood", "yard-props"], []]
  },
  persian: {
    0: [["crown-ornaments", "yard-props"], []],
    5: [[], ["band", "crown-ornaments", "door-hood"]],
    15: [["crown-ornaments", "door-hood", "yard-props"], []]
  },
  chinese: {
    0: [["crown-ornaments", "yard-props"], []],
    5: [[], ["band", "crown-ornaments", "door-hood"]],
    15: [["crown-ornaments", "door-hood", "yard-props"], []]
  },
  indigenous: {
    0: [["crown-ornaments", "yard-props"], []],
    5: [[], ["band", "crown-ornaments", "door-hood"]],
    15: [["crown-ornaments", "door-hood", "yard-props"], []]
  },
  japanese: {
    6: [[], ["band", "banner", "crown-ornaments", "yard-props"]],
    15: [[], ["banner", "crown-ornaments"]],
    28: [[], ["crown-ornaments"]],
    29: [[], ["crown-ornaments"]],
    40: [[], ["banner", "crown-ornaments"]]
  },
  nubian: {
    0: [["yard-props"], ["band", "banner", "door-hood", "yard-props"]],
    6: [[], ["band", "banner", "yard-props"]],
    9: [["yard-props"], []]
  },
  roman: {
    0: [["crown-ornaments", "yard-props"], []],
    5: [[], ["band", "crown-ornaments", "door-hood"]],
    15: [["crown-ornaments", "door-hood", "yard-props"], []]
  },
  viking: {
    18: [[], ["banner", "crown-ornaments", "yard-props"]],
    20: [[], ["banner"]],
    24: [[], ["banner", "crown-ornaments", "yard-props"]],
    25: [["yard-props"], []],
    40: [[], ["band", "banner", "crown-ornaments", "yard-props"]]
  }
};

const NONE: LeanSet = [];

const leanPieces = (site: LevelSite) =>
  LEAN_MODELS[site.nation][buildingFamilyId(site.definition.id)]?.[site.detailed ? 0 : 1] ?? NONE;

/** True when this model leaves the piece out to stay within its triangle budget. */
export const isLeanPiece = (site: LevelSite, piece: LeanPiece) => leanPieces(site).includes(piece);
