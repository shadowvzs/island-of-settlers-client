/** Surface-gradient bump mapping shared by fur and bark; world-space derivatives need no tangents. */
export const DERIVATIVE_BUMP_GLSL = `
vec3 perturbDerivativeNormal(vec3 position, vec3 normal, float height) {
  vec3 sigmaX = dFdx(position);
  vec3 sigmaY = dFdy(position);
  vec3 r1 = cross(sigmaY, normal);
  vec3 r2 = cross(normal, sigmaX);
  float determinant = dot(sigmaX, r1);
  vec2 slope = vec2(dFdx(height), dFdy(height));
  vec3 gradient = sign(determinant) * (slope.x * r1 + slope.y * r2);
  return normalize(abs(determinant) * normal - gradient);
}
`;
