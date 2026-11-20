/** The side left standing after a battle, or `undecided` when both or neither survive. */
export const battleWinner = <T extends string>(left: number, right: number, undecided: T) => {
  if (left && !right) return "left";
  return right && !left ? "right" : undecided;
};

/** The settlement's home building type in a save: the harbour (39), the headquarters (0) or none. */
export const savedHomeBuilding = (home: { typeId: number } | undefined) => {
  if (home?.typeId === 39) return 39;
  return home?.typeId === 0 ? 0 : null;
};
