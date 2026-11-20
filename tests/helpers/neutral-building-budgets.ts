/** Triangle ceiling for a neutral/camp building model: type 9 is the big fortified variant. */
export const neutralBuildingTriangleLimit = (type: number, detailed: boolean, bigMinimalLimit = 2300) => {
  if (type === 9) return detailed ? 15000 : bigMinimalLimit;
  return detailed ? 10000 : 2300;
};
