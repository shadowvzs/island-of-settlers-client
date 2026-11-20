import type { BuildingPart, BuildingRecipe } from "./building-recipe";

const yaw = (part: BuildingPart) => part.rotation?.[1] ?? 0;
const near = (a: number, b: number) => Math.abs(a - b) < .006;

/** Only closed oval chambers need oval roof plans; rectangular open iwans retain their full piers. */
export const withPersianClosedVaultJoins = (recipe: BuildingRecipe, id: number): BuildingRecipe => {
  if (id === 4 || id === 9) return recipe;
  const caps = recipe.parts.filter(part => part.shape === "persian-room" && part.occupationRoof === "barrel");
  const pairs = recipe.parts.flatMap(roof => {
    if (roof.shape !== "occupation-roof" || roof.occupationRoof !== "barrel" || roof.size[2] < .1) return [];
    const cap = caps.find(cap => near(cap.position[0], roof.position[0]) && near(cap.position[2], roof.position[2]) &&
      near(yaw(cap), yaw(roof)) && cap.size[0] <= roof.size[0] + .006 && cap.size[2] <= roof.size[2] + .006 &&
      near(cap.position[1] + cap.size[1] / 2, roof.position[1] + roof.size[1] * .37 + .002));
    return cap ? [{ cap, roof }] : [];
  });
  if (!pairs.length) return recipe;
  return { ...recipe, parts: recipe.parts.flatMap(part => {
    const pair = pairs.find(pair => pair.roof === part);
    if (pair) return [{ ...part, persianRoofPlan: [pair.cap.size[0] / part.size[0],
      pair.cap.size[2] / part.size[2]] as [number, number] }];
    // These discarded rectangular end plates/ribs belonged to the old rectangular roof, not its oval room.
    if (part.shape === "roof-infill" && pairs.some(({ roof }) => near(part.position[0], roof.position[0]) &&
      near(part.position[2], roof.position[2]) && near(yaw(part), yaw(roof)) &&
      near(part.position[1], roof.position[1]))) return [];
    if (part.shape === "occupation-roof" && part.surface === "paint" && part.size[2] < .08 &&
      pairs.some(({ roof }) => {
        const turned = Math.abs(Math.sin(yaw(roof))) > .5, across = turned ? 2 : 0, along = turned ? 0 : 2;
        return near(yaw(part), yaw(roof)) && near(part.position[across], roof.position[across]) &&
          Math.abs(part.position[along] - roof.position[along]) < roof.size[2] / 2 &&
          near(part.position[1], roof.position[1]) && Math.abs(part.size[0] - roof.size[0]) < .02;
      })) return [];
    return [part];
  }) };
};
