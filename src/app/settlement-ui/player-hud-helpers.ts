const icons = import.meta.glob<string>("../../../assets/ui-icons/{gem,quest-scroll,level-star,portrait-frame}.png", {
  eager: true, import: "default", query: "?url"
});
const victoryEmblems = import.meta.glob<string>("../../../assets/ui-icons/victory-emblem-*.png", {
  eager: true, import: "default", query: "?url"
});

export const progressionIcon = (
  name: "gem" | "quest-scroll" | "level-star" | "portrait-frame"
) =>
  icons[`../../../assets/ui-icons/${name}.png`]!;

/** The nation's victory emblem (tools/bench/victory-emblems.ts); Roman for an unknown nation. */
export const victoryEmblem = (nation: string) =>
  victoryEmblems[`../../../assets/ui-icons/victory-emblem-${nation}.png`] ??
  victoryEmblems["../../../assets/ui-icons/victory-emblem-roman.png"]!;
