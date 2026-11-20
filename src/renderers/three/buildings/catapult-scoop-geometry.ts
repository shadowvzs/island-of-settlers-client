import { LatheGeometry, Vector2 } from "three";

/** A carved wooden oval scoop: closed underside, hollow interior and a rounded retaining lip. */
export const createCatapultScoopGeometry = (detailed: boolean) => new LatheGeometry([
  [0, -.5], [.18, -.5], [.34, -.45], [.46, -.18], [.5, .25], [.48, .5],
  [.40, .5], [.39, .20], [.34, -.08], [.22, -.20], [0, -.22]
].map(([radius, height]) => new Vector2(radius!, height!)), detailed ? 24 : 12);
