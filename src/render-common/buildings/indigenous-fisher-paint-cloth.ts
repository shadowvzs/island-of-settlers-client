import type { BuildingPart, BuildingRecipe } from "./building-recipe";

/** A small stitched working-bay cloth hangs from the two real front canopy posts. */
export const indigenousFisherPaintCloth = (recipe: BuildingRecipe, side: "left" | "right" = "left"): BuildingPart[] => {
  const posts = recipe.parts.filter(part => part.shape === "cylinder" && part.surface === "wood" &&
    part.size[0] === .045 && part.size[1] > .8);
  const front = Math.max(...posts.map(part => part.position[2]));
  const pair = posts.filter(part => Math.abs(part.position[2] - front) < .001)
    .sort((a, b) => a.position[0] - b.position[0]);
  if (pair.length !== 2) return [];
  const left = pair[0]!, right = pair[1]!;
  const top = Math.min(...pair.map(part => part.position[1] + part.size[1] / 2)) - .025;
  const width = Math.min(.55, (right.position[0] - left.position[0]) * .4);
  const height = Math.min(.41, top * .38);
  const leftCentre = left.position[0] + .045 + width / 2;
  const rightCentre = right.position[0] - .045 - width / 2;
  let x = side === "left" ? leftCentre : rightCentre;
  const z = front + .025, clothTop = top - .05;
  const doorRight = recipe.door[0] + (recipe.doorDimensions?.width ?? .46);
  const crossesDoor = (centre: number) => Math.abs(front - recipe.door[2]) < .2 &&
    clothTop - height < (recipe.doorDimensions?.height ?? .77) + .03 &&
    centre + width / 2 > recipe.door[0] - .03 && centre - width / 2 < doorRight + .03;
  // The fisher's entrance occupies the left bay; hang its art in the supported free bay.
  if (crossesDoor(x)) x = side === "left" ? rightCentre : leftCentre;
  if (crossesDoor(x)) return [];
  const parts: BuildingPart[] = [{ architecture: true, shape: "box", stage: 2, surface: "wood",
    position: [(left.position[0] + right.position[0]) / 2, top, front],
    size: [right.position[0] - left.position[0] + .045, .025, .035] }];
  for (const side of [-1, 1]) parts.push({ architecture: true, shape: "cylinder", stage: 2,
    surface: "rope", radialSegments: 4, position: [x + side * width * .46, top - .025, z],
    size: [.008, .065, .008] });
  parts.push({ architecture: true, shape: "cloth-panel", stage: 2, surface: "cloth",
    position: [x, clothTop - height / 2, z], size: [width, height, .016],
    clothPanelCorners: [[-.5, -.5, 0], [.5, -.5, 0], [.5, .5, 0], [-.5, .5, 0]] });
  return parts;
};
