import type { Page } from "playwright-core";

/**
 * Review-only shell row (never in game code): the served shore-details module is patched so its
 * shore details end with one instance of every shell kind and variant, walking along the beach
 * from `start` at 1 cell from the water (each grounded and tilted like the real shells).
 */
const ROW_IMPORTS = `import { COVER as __COVER, getMeshId, getVariantCount } from "/src/render-common/props/prop-mesh-layout.ts";
import { sampleBilinear } from "/src/shared/world/grid-geometry.ts";
`;

const ROW_CODE = (start: { x: number; z: number }) => `
const COVER = __COVER;
function __reviewShellRow(world, shells) {
  const tints = [[1, 0.6, 0.28], [1, 0.52, 0.58], [0.78, 0.6, 1], [1, 0.86, 0.32], [1, 0.93, 0.8]];
  const kinds = [COVER.seashell, COVER.openShell, COVER.seaStar, COVER.seaSnailShell, COVER.snailShell];
  const coast = (x, z) => sampleBilinear(world, world.coastDistance, x, z);
  let x = ${start.x}, z = ${start.z}, along = null, index = 0;
  for (const kind of kinds) for (let variant = 0; variant < getVariantCount(kind); variant++) {
    for (let step = 0; step < 6; step++) {
      const gx = (coast(x + 0.2, z) - coast(x - 0.2, z)) / 0.4, gz = (coast(x, z + 0.2) - coast(x, z - 0.2)) / 0.4;
      const g = Math.hypot(gx, gz) || 1;
      x += gx / g * (1.0 - coast(x, z)) * 0.5; z += gz / g * (1.0 - coast(x, z)) * 0.5;
      if (step === 5) {
        const tangent = [-gz / g, gx / g];
        if (!along || tangent[0] * along[0] + tangent[1] * along[1] < 0) along = along ? [-tangent[0], -tangent[1]] : tangent;
        else along = tangent;
      }
    }
    const meshId = getMeshId(kind, variant);
    const pose = { rotation: 0.7, scale: 1, tilt: getGroundTilt(world, x, z) };
    const y = getRestHeight(getMeshContact(meshId), pose, { x, z }, (px, pz) => sampleRenderedHeight(world, px, pz));
    const tint = kind === COVER.seashell || kind === COVER.openShell ? tints[index % tints.length] : [1, 1, 1];
    shells.push({ ...pose, meshId, phase: 0, sourceIndex: -1, stretch: 1, tint, x, y, z });
    x += along[0] * 0.55; z += along[1] * 0.55; index++;
  }
  return shells;
}
`;

export const routeReviewRow = (start: { x: number; z: number }) => async (page: Page) => {
  await page.context().route("**/shore-details.ts*", async route => {
    const response = await route.fetch();
    const body = ROW_IMPORTS + (await response.text())
      .replace("export const collectShoreDetails =", "const __collectShoreDetails =")
      + ROW_CODE(start)
      + "export const collectShoreDetails = (world) => __reviewShellRow(world, __collectShoreDetails(world));\n";
    await route.fulfill({ body, response });
  });
};
