export const DRINK_WORK_ACTIONS = ["pick_tea", "pick_pomegranate", "pick_cacao", "pick_berries",
  "brew_tea", "press_pomegranate", "grind_cacao", "infuse_berries"] as const;
export type DrinkWorkAction = typeof DRINK_WORK_ACTIONS[number];
export const isDrinkWorkAction = (action: string): action is DrinkWorkAction =>
  (DRINK_WORK_ACTIONS as readonly string[]).includes(action);

export const DRINK_GROWER_ACTIONS: Readonly<Record<string, DrinkWorkAction>> = {
  "Tea grower": "pick_tea", "Pomegranate grower": "pick_pomegranate",
  "Cacao grower": "pick_cacao", "Berry grower": "pick_berries"
};
export const DRINK_MAKER_ACTIONS: Readonly<Record<string, DrinkWorkAction>> = {
  "Tea brewer": "brew_tea", "Pomegranate presser": "press_pomegranate",
  "Cacao brewer": "grind_cacao", "Berry infuser": "infuse_berries"
};

/** Presentation cycles repeat inside the shared production timer; none advances the economy. */
export const sampleDrinkHand = (action: DrinkWorkAction, time: number, right: boolean) => {
  const phase = ((time % 4) + 4) % 4 / 4;
  const wave = Math.sin(phase * Math.PI * 2), cosine = Math.cos(phase * Math.PI * 2);
  const reach = Math.sin(phase * Math.PI) ** 2;
  const sign = right ? -.1 : .1;
  if (action === "pick_tea") return right
    ? [sign + .025 * wave, .55 + reach * .17, .16 + reach * .2] as const : [sign, .53, .2] as const;
  if (action === "pick_pomegranate") return right
    ? [sign + .035 * wave, .58 + reach * .29, .17 + reach * .19] as const : [sign, .56, .22] as const;
  if (action === "pick_cacao") return [sign, .52 + reach * (right ? .14 : .08), .18 + reach * .17] as const;
  if (action === "pick_berries") return [sign + wave * .025, .43 + reach * .06, .22 + reach * .14] as const;
  if (action === "brew_tea") return right
    ? [sign - .04 * reach, .63 + reach * .18, .24 + reach * .05] as const : [sign, .61, .3] as const;
  if (action === "press_pomegranate") return [sign, .65 + wave * .12, .3 + wave * .025] as const;
  if (action === "grind_cacao") return [sign, .57 + .015 * cosine, .28 + wave * .09] as const;
  return right ? [sign + cosine * .065, .6, .29 + wave * .055] as const : [sign, .58, .29] as const;
};
