import { msg } from "@lingui/core/macro";

/**
 * Canonical player-facing domain names: generic enemy labels, materials and nations (ware, building, bandit site,
 * job and troop names live in the shared content catalog, `island-of-settlers-shared/src/catalog/data/`).
 * Save ids stay the keys (never shown); the English source is the current display name, so callers
 * that do not pass an I18n instance keep the exact existing text.
 */
export const DOMAIN_NAME_MESSAGES = {
  /** Generic enemy labels; the bandit site names and tiers are the content catalog's `bandit:*` texts. */
  bandit: {
    enemyCamp: msg({ id: "domain.bandit.enemyCamp", message: "Enemy camp" }),
    enemyFort: msg({ id: "domain.bandit.enemyFort", message: "Enemy fort" })
  },
  material: {
    basalt: msg({ id: "domain.material.basalt", message: "basalt" }),
    cedar: msg({ id: "domain.material.cedar", message: "cedar" }),
    granite: msg({ id: "domain.material.granite", message: "granite" }),
    hardwood: msg({ id: "domain.material.hardwood", message: "hardwood" }),
    limestone: msg({ id: "domain.material.limestone", message: "limestone" }),
    mahogany: msg({ id: "domain.material.mahogany", message: "mahogany" }),
    marble: msg({ id: "domain.material.marble", message: "marble" }),
    softwood: msg({ id: "domain.material.softwood", message: "softwood" }),
    stone: msg({ id: "domain.material.stone", message: "stone" }),
    walnut: msg({ id: "domain.material.walnut", message: "walnut" })
  },
  nation: {
    japanese: msg({ id: "domain.nation.japanese", message: "Japanese" }),
    nubian: msg({ id: "domain.nation.nubian", message: "Nubian" }),
    roman: msg({ id: "domain.nation.roman", message: "Roman" }),
    viking: msg({ id: "domain.nation.viking", message: "Viking" })
  }
} as const;
