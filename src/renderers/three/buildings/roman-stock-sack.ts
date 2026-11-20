import { LatheGeometry, Vector2 } from "three";

/** Flattened standing sack with a full belly, folded shoulder and tied neck. */
export const createRomanStockSack = (detailed: boolean, segments = detailed ? 16 : 6) => {
  const profile = [
    [0, -0.5],
    [0.24, -0.5],
    [0.39, -0.46],
    [0.48, -0.25],
    [0.47, 0.04],
    [0.39, 0.28],
    [0.23, 0.39],
    [0.12, 0.44],
    [0.14, 0.48],
    [0, 0.5]
  ];
  const geometry = new LatheGeometry(
    (detailed ? profile : [[0, -.5], [.24, -.5], [.48, -.25], [.14, .48], [0, .5]])
      .map(([r, y]) => new Vector2(r, y)),
    segments
  );
  // Six sides retain the original sack envelope with fewer buried profile rings.
  if (!detailed) { geometry.scale(2 / Math.sqrt(3), 1, 1); return geometry; }
  const positions = geometry.getAttribute("position");
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i);
    const angle = Math.atan2(x, z);
    const fold = 1 + Math.sin(angle * 7 + y * 8) * 0.028;
    positions.setXYZ(i, x * fold, y, z * fold);
  }
  geometry.computeVertexNormals();
  return geometry;
};

/** Open rolled mouth with an inner cloth wall; the mineral fill sits below the rim. */
export const createRomanOpenStockSack = (detailed: boolean, segments = detailed ? 12 : 6) => {
  const profile = detailed
    ? [
        [0, -0.5],
        [0.34, -0.5],
        [0.48, -0.38],
        [0.47, 0.12],
        [0.38, 0.43],
        [0.36, 0.5],
        [0.31, 0.48],
        [0.32, 0.28],
        [0, 0.28]
      ]
    : [
        [0, -0.5],
        [0.48, -0.5],
        [0.38, 0.5],
        [0.3, 0.5],
        [0.3, 0.28],
        [0, 0.28]
      ];
  const geometry = new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    segments
  );
  const positions = geometry.getAttribute("position");
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i);
    const fold = 1 + Math.sin(Math.atan2(x, z) * 6 + y * 7) * 0.025;
    positions.setXYZ(i, x * fold, y, z * fold);
  }
  geometry.computeVertexNormals();
  return geometry;
};
