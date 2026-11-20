import { cos, dot, Fn, length, sin, vec2, vec3 } from "three/tsl";

type TslNode = any; // TSL's generated types do not model the proxied node methods.
type NoiseNode = (point: TslNode) => TslNode;

/**
 * TSL twin of `WIND_GLSL` (prop-glsl). `noise` is the scalar value-noise function from the
 * noise module; wind/phase/time are nodes, so materials keep their existing uniforms.
 */
export const createWindNodes = (noise: NoiseNode) => {
  const windDisplacement = Fn(([xz, phase, time, wind, windPhase]:
  [TslNode, TslNode, TslNode, TslNode, TslNode]) => {
    const strength = length(wind);
    const direction = wind.div(strength.max(0.001));
    const gust = noise(xz.mul(0.07).sub(windPhase.mul(0.35)));
    const push = gust.mul(gust).mul(1.8).add(0.3).mul(strength);
    const sway = sin(time.mul(1.9).add(phase).add(dot(xz, vec2(0.37, 0.23))))
      .mul(gust.mul(0.6).add(0.4));
    const tremble = sin(time.mul(7.3).add(phase.mul(2.3))).mul(gust.mul(gust));
    const across = vec2(direction.y.negate(), direction.x)
      .mul(sin(time.mul(1.3).add(phase.mul(1.7)))).mul(0.006);
    return direction.mul(push).mul(sway.mul(0.035).add(tremble.mul(0.012)).add(0.08))
      .add(across.mul(strength));
  });

  const flutterOffset = Fn(([position, phase, time]: [TslNode, TslNode, TslNode]) => vec3(
    sin(time.mul(11).add(phase.mul(3)).add(position.y.mul(11))),
    sin(time.mul(9.4).add(phase).add(position.x.mul(9))).mul(0.5),
    cos(time.mul(12.3).add(phase.mul(2)).add(position.z.mul(13)))
  ).mul(0.014));

  const branchSway = Fn(([position, phase, time, wind]: [TslNode, TslNode, TslNode, TslNode]) => {
    const wave = phase.add(dot(position.xz, vec2(5.3, 4.1))).add(position.y.mul(2));
    const strength = length(wind).add(0.4);
    return vec3(
      sin(time.mul(3.1).add(wave)),
      0,
      cos(time.mul(2.7).add(wave.mul(1.3)))
    ).mul(0.012).mul(strength);
  });

  return { branchSway, flutterOffset, windDisplacement };
};
