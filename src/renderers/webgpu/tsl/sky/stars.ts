import {
  abs, cos, dot, exp, float, floor, Fn, If, length, max, mix, normalize, sign, sin,
  smoothstep, step, vec2, vec3
} from "three/tsl";

import {
  EXPLORATION_MOON_DISC_RADIUS,
  EXPLORATION_STARS
} from "../../../../render-common/atmosphere/exploration-sky-constants";
import {
  bindComputed,
  bindMatrix,
  bindScalar,
  bindVector,
  type UniformBindings
} from "../uniform-bindings";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

const SKY_TAU = Math.PI * 2;

/** GLSL starHash: a stable per-cell hash of the cube face and cell. */
export const starHash = Fn(([point]: [TslNode]) => {
  const value = point.toVar();
  value.assign(value.mul(vec3(0.1031, 0.103, 0.0973)).fract());
  // Explicit vec3 broadcast: GLSL allows `p += float`, WGSL does not.
  value.assign(value.add(vec3(dot(value, value.yxz.add(33.33)))));
  return value.xxy.add(value.yxx).mul(value.zyx).fract();
});

/** GLSL starLayer: the star of this direction's cell as display light (0 when empty). */
export const starLayer = Fn(([starDirection, faceUv, faceAxis, faceU, faceV, face, cells,
  share, seed, pixelAngle, brightness, twinkleAmount, gathering, faintFloor, starTime]: [
  TslNode, TslNode, TslNode, TslNode, TslNode, TslNode, TslNode, TslNode, TslNode, TslNode,
  TslNode, TslNode, TslNode, TslNode, TslNode]) => {
  const light = vec3(0).toVar();
  const cell: TslNode = floor(faceUv.mul(0.5).add(0.5).mul(cells));
  const place: TslNode = starHash(vec3(cell, face.mul(13).add(seed)));
  If(place.x.lessThan(share), () => {
    const starUv: TslNode = cell.add(0.25).add(place.yz.mul(0.5)).div(cells).mul(2).sub(1);
    const star = normalize(faceAxis.add(faceU.mul(starUv.x)).add(faceV.mul(starUv.y)));
    const look: TslNode = starHash(vec3(cell.yx, face.mul(7).add(seed).add(101)));
    // A steep power law: few bright stars, many faint ones (look.x^6).
    let rank: TslNode = look.x.mul(look.x).mul(look.x);
    rank = rank.mul(rank);
    // Bright stars spread only a little wider; the minimum sigma is 0.75 px.
    const sigma = max(pixelAngle.mul(float(0.75).add(rank.mul(0.3))), 0.00001);
    const offset = starDirection.sub(star);
    const profile = exp(dot(offset, offset).negate().div(sigma.mul(2).mul(sigma)));
    const magnitude = brightness.x.add(brightness.y.mul(rank));
    const magnitudeLight = max(magnitude.mul(gathering).sub(faintFloor), 0);
    const warm = vec3(1, 0.86, 0.7);
    const blue = vec3(0.8, 0.88, 1);
    const tint = look.y.lessThan(0.5)
      .select(mix(warm, vec3(1), look.y.mul(2)), mix(vec3(1), blue, look.y.mul(2).sub(1)));
    const twinkle = float(1).add(twinkleAmount.mul(look.z.sub(0.5))
      .mul(sin(starTime.mul(EXPLORATION_STARS.twinkleFast).add(look.z.mul(40))))
      .mul(sin(starTime.mul(EXPLORATION_STARS.twinkleSlow).add(look.x.mul(23)))));
    light.assign(tint.mul(magnitudeLight).mul(profile).mul(twinkle));
  });
  return light;
});

/** GLSL starMilkyWay: a great-circle band with slow clumps and a darker rift. */
export const starMilkyWay = Fn(([starDirection]: [TslNode]) => {
  const latitude = dot(starDirection, normalize(vec3(0.32, 0.55, 0.77)));
  const band = exp(latitude.negate().mul(latitude).div(0.05));
  const clumps = float(0.65).add(float(0.35)
    .mul(sin(starDirection.x.mul(9).add(1.3)))
    .mul(sin(starDirection.z.mul(7).add(0.4))));
  const rift = float(1).sub(float(0.45)
    .mul(exp(latitude.sub(0.03).negate().mul(latitude.sub(0.03)).div(0.002))));
  return band.mul(clumps).mul(rift);
});

export interface StarNodes {
  radiance: (direction: TslNode, lightDirection: TslNode, skyColor: TslNode) => TslNode;
}

/** TSL twin of EXPLORATION_STARS_GLSL (procedural night stars, no texture or pass). */
export const createStarNodes = (bindings: UniformBindings): StarNodes => {
  const starFrame = bindMatrix(bindings, "uStarFrame") as TslNode;
  const starParams = bindVector(bindings, "uStarParams", 4) as TslNode;
  const moonPhase = bindScalar(bindings, "uMoonPhase", 0.5) as TslNode;
  // The spyglass gathers more light than the eye: faint stars brighten with its magnification.
  const gathering = bindComputed(bindings, () => {
    const matrix = bindings.source.uInverseProjection?.value as { elements?: ArrayLike<number> };
    const projectionY = Number(matrix?.elements?.[5] ?? 1);
    return Math.min(4, Math.max(1, EXPLORATION_STARS.eyeHalfFovTan / projectionY));
  }) as TslNode;

  /** EXPLORATION_STARS_GLSL explorationStarRadiance. */
  const radiance = (direction: TslNode, lightDirection: TslNode, skyColor: TslNode): TslNode => {
    const result = vec3(0).toVar();
    If(starParams.x.greaterThan(0).and(direction.y.greaterThanEqual(-0.02)), () => {
      const skyLuma = dot(skyColor, vec3(0.299, 0.587, 0.114));
      const contrast = float(1).sub(smoothstep(0.1, 0.32, skyLuma));
      const moonRadius = EXPLORATION_MOON_DISC_RADIUS * 1.12;
      // The lit moon covers what is behind it; a new moon (not in a real night sky) hides nothing.
      const moonLit = smoothstep(0, 0.1,
        float(0.5).mul(float(1).sub(cos(moonPhase.mul(SKY_TAU)))));
      const insideMoon = step(1 - 0.5 * moonRadius * moonRadius,
        dot(direction, lightDirection));
      const outsideMoon = float(1).sub(insideMoon.mul(moonLit));
      const horizon = smoothstep(-0.02, 0.14, direction.y);
      const visible = starParams.x.mul(contrast).mul(outsideMoon).mul(horizon);
      If(visible.greaterThan(0), () => {
        const starDirection: TslNode = starFrame.mul(direction);
        const extent: TslNode = abs(starDirection);
        // Every branch assigns all five values (porting-guide pitfall P1).
        const faceAxis = vec3(0).toVar();
        const faceU = vec3(0).toVar();
        const faceV = vec3(0).toVar();
        const faceUv = vec2(0).toVar();
        const face = float(0).toVar();
        If(extent.x.greaterThanEqual(extent.y).and(extent.x.greaterThanEqual(extent.z)), () => {
          faceAxis.assign(vec3(sign(starDirection.x), 0, 0));
          faceU.assign(vec3(0, 1, 0));
          faceV.assign(vec3(0, 0, 1));
          faceUv.assign(starDirection.yz.div(extent.x));
          face.assign(starDirection.x.greaterThan(0).select(0, 1));
        }).ElseIf(extent.y.greaterThanEqual(extent.z), () => {
          faceAxis.assign(vec3(0, sign(starDirection.y), 0));
          faceU.assign(vec3(1, 0, 0));
          faceV.assign(vec3(0, 0, 1));
          faceUv.assign(starDirection.xz.div(extent.y));
          face.assign(starDirection.y.greaterThan(0).select(2, 3));
        }).Else(() => {
          faceAxis.assign(vec3(0, 0, sign(starDirection.z)));
          faceU.assign(vec3(1, 0, 0));
          faceV.assign(vec3(0, 1, 0));
          faceUv.assign(starDirection.xy.div(extent.z));
          face.assign(starDirection.z.greaterThan(0).select(4, 5));
        });
        const pixelAngle = max(length(direction.dFdx()), length(direction.dFdy()));
        // Scintillation needs the long air path: only stars low over the horizon twinkle.
        const twinkleAmount = float(0.6).mul(float(1).sub(smoothstep(0.04, 0.3, direction.y)));
        const light: TslNode = starLayer(starDirection, faceUv, faceAxis, faceU, faceV, face,
          EXPLORATION_STARS.brightCells, EXPLORATION_STARS.brightShare, 0, pixelAngle,
          vec2(0.12, 1.1), twinkleAmount, gathering, starParams.y, starParams.w).toVar();
        If(starParams.z.greaterThan(1.5), () => {
          const milkyWay: TslNode = starMilkyWay(starDirection);
          const share = float(EXPLORATION_STARS.faintShare).mul(float(1).add(milkyWay.mul(1.6)));
          const faint: TslNode = starLayer(starDirection, faceUv, faceAxis, faceU, faceV, face,
            EXPLORATION_STARS.faintCells, share, 57, pixelAngle, vec2(0.035, 0.1),
            twinkleAmount, gathering, starParams.y, starParams.w);
          light.assign(light.add(faint));
          light.assign(light.add(vec3(0.82, 0.87, 1).mul(0.1).mul(milkyWay)
            .mul(max(float(1).sub(starParams.y.mul(8)), 0))));
        });
        result.assign(light.mul(visible));
      });
    });
    return result;
  };

  return { radiance };
};
