/** Unlock conditions that read the home island: they never hold without one (plan §13.3, rev H5). */
export const HOME_UNLOCK_KINDS: ReadonlySet<string> = new Set(["homeBuilding", "homeGoods"]);
/** Reward kinds paid into the account wallet; every other kind sails to the home island (plan §9.3). */
export const WALLET_REWARD_KINDS: ReadonlySet<string> = new Set(["gems", "xp"]);
