/**
 * GLSL sculpt of the original Japanese sail dragon (owner 2026-10-13: a full coiled dragon in the manner
 * of the references dragon-6/7/8, not a copy): a signed distance field of the head with an open roaring
 * jaw, teeth, eye, antler horns, spiky mane and whiskers, an S-coiled scaled body with segmented belly
 * plates, three clawed legs and a finned tail. World space: x right, y up, z to the viewer; the frame
 * spans about -1.1..1.1. `map` returns (distance, material).
 */
export const DRAGON_SCULPT_GLSL = /* glsl */ `
const float PI = 3.14159265;
const float M_SKIN = 1.0, M_BODY = 2.0, M_BELLY = 3.0, M_HORN = 4.0, M_MANE = 5.0, M_LEG = 6.0;
const float M_MOUTH = 7.0, M_TONGUE = 8.0, M_TOOTH = 9.0, M_EYE = 10.0, M_WHISKER = 11.0, M_JAW = 12.0;
const float M_CLAW = 13.0;

const vec3 HEAD_ORIGIN = vec3(-0.08, 0.38, 0.05);
const float HEAD_SCALE = 0.95, HEAD_YAW = 0.5, HEAD_PITCH = 0.12;
const float JAW_OPEN = 0.55;
const vec3 JAW_HINGE = vec3(0.02, -0.1, 0.0);
const vec3 EYE_CENTRE = vec3(-0.3, 0.1, 0.148);
const float EYE_RADIUS = 0.048;

/** The body's spine: five C1-joined quadratic Bezier segments from the skull to the tail tip. */
const vec3 SPINE[11] = vec3[](
  vec3(0.06, 0.42, -0.08), vec3(0.55, 0.98, -0.3), vec3(0.72, 0.36, -0.25),
  vec3(0.8, 0.07, -0.2), vec3(0.35, -0.15, -0.05),
  vec3(-0.1, -0.37, 0.0), vec3(-0.25, -0.7, -0.05),
  vec3(-0.4, -1.03, -0.1), vec3(0.15, -0.98, -0.15),
  vec3(0.6, -0.94, -0.2), vec3(0.84, -0.62, -0.25));

float dot2(vec3 v) { return dot(v, v); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
float smax(float a, float b, float k) { return -smin(-a, -b, k); }
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float sdEllipsoid(vec3 p, vec3 r) { float k0 = length(p / r), k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / k1; }

float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 ba = b - a; float l2 = dot(ba, ba), rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1.0 / l2;
  vec3 pa = p - a; float y = dot(pa, ba), z = y - l2;
  float x2 = dot2(pa * l2 - ba * y), y2 = y * y * l2, z2 = z * z * l2, k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

/** Distance to a quadratic Bezier (after iq) and the curve parameter of the closest point. */
vec2 sdBezier(vec3 pos, vec3 A, vec3 B, vec3 C) {
  vec3 a = B - A, b = A - 2.0 * B + C, c = a * 2.0, d = A - pos;
  float kk = 1.0 / dot(b, b), kx = kk * dot(a, b), ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0;
  float kz = kk * dot(d, a), p = ky - kx * kx, q = kx * (2.0 * kx * kx - 3.0 * ky) + kz, h = q * q + 4.0 * p * p * p;
  vec2 res;
  if (h >= 0.0) {
    h = sqrt(h); vec2 x = (vec2(h, -h) - q) / 2.0, uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0); res = vec2(dot2(d + (c + b * t) * t), t);
  } else {
    float z = sqrt(-p), v = acos(q / (p * z * 2.0)) / 3.0, m = cos(v), n = sin(v) * 1.732050808;
    vec3 t = clamp(vec3(m + m, -n - m, n - m) * z - kx, 0.0, 1.0);
    float dis = dot2(d + (c + b * t.x) * t.x); res = vec2(dis, t.x);
    dis = dot2(d + (c + b * t.y) * t.y); if (dis < res.x) res = vec2(dis, t.y);
  }
  return vec2(sqrt(res.x), res.y);
}

vec3 bezierAt(vec3 A, vec3 B, vec3 C, float t) { return mix(mix(A, B, t), mix(B, C, t), t); }

/** A tapering blade (spike, horn tine, claw) along a Bezier, flattened along 'flatAxis' by 'squash'. */
float blade(vec3 p, vec3 A, vec3 B, vec3 C, float r0, vec3 flatAxis, float squash) {
  vec2 hit = sdBezier(p, A, B, C);
  if (hit.x > r0 * 2.5 + 0.02) return hit.x - r0;
  vec3 o = p - bezierAt(A, B, C, hit.y);
  o += flatAxis * dot(o, flatAxis) * (squash - 1.0);
  return (length(o) - r0 * pow(1.0 - hit.y, 1.15)) / squash;
}

/**
 * Overlapping shingle scales over (u, v) in scale units, u running towards the free edges; the scale
 * of the lower row lies on top. Returns (height 0..1, scale id hash, outline 0..1 along the free edge).
 */
vec3 shingles(vec2 uv) {
  float r0 = floor(uv.x + 0.5);
  for (int i = -1; i <= 1; i++) {
    float row = r0 + float(i), offset = 0.5 * mod(row, 2.0), col = floor(uv.y - offset + 0.5);
    for (int j = -1; j <= 1; j++) {
      vec2 centre = vec2(row, col + float(j) + offset), local = uv - centre;
      float shape = length(vec2((local.x - 0.12) / 0.86, local.y / 0.66));
      if (shape > 1.0) continue;
      float rise = smoothstep(-0.75, 0.8, local.x), dome = 1.0 - 0.45 * pow(local.y / 0.66, 2.0);
      float height = mix(0.3, 1.0, rise) * dome * (1.0 - smoothstep(0.8, 1.0, shape));
      return vec3(height, hash21(centre), smoothstep(0.82, 0.95, shape) * smoothstep(-0.2, 0.1, local.x));
    }
  }
  return vec3(0.0, 0.0, 1.0);
}

/** Head-local point from world space (undo position, scale, yaw, then pitch). */
vec3 toHead(vec3 p) {
  vec3 q = (p - HEAD_ORIGIN) / HEAD_SCALE;
  q.xz = rot(HEAD_YAW) * q.xz;
  q.xy = rot(-HEAD_PITCH) * q.xy;
  return q;
}

/** Closed-jaw point from head space. */
vec3 toJaw(vec3 h) { vec3 j = h - JAW_HINGE; j.xy = rot(-JAW_OPEN) * j.xy; return j + JAW_HINGE; }

/** Head scale coordinates: rows from the nose back, smaller on the snout. */
vec2 headScaleUv(vec3 h, float centreY) {
  float size = 0.042 * exp(0.6 * h.x);
  float u = -exp(-0.6 * h.x) / (0.6 * 0.042);
  float angle = atan(abs(h.z), h.y - centreY);
  return vec2(u, angle * 0.16 / size);
}

float headCentreY(vec3 h) { return mix(0.0, 0.06, smoothstep(-0.7, -0.1, h.x)); }

/** The upper head: cranium, snout, nose, brows, cheeks; the eye sockets carved in. */
float upperHead(vec3 h) {
  vec3 q = vec3(h.xy, abs(h.z));
  float d = sdEllipsoid(h - vec3(0.0, 0.06, 0.0), vec3(0.27, 0.22, 0.2));
  d = smin(d, sdRoundCone(h * vec3(1.0, 1.08, 1.18), vec3(-0.12, 0.02, 0.0), vec3(-0.76, 0.0, 0.0), 0.17, 0.09) / 1.18,
    0.08);
  d = smin(d, sdEllipsoid(q - vec3(-0.79, 0.035, 0.045), vec3(0.1, 0.075, 0.075)), 0.05);
  d = smin(d, sdEllipsoid(q - vec3(-0.83, 0.085, 0.055), vec3(0.05, 0.035, 0.042)), 0.025);
  d = smax(d, -sdEllipsoid(q - vec3(-0.865, 0.1, 0.066), vec3(0.024, 0.018, 0.026)), 0.012);
  vec3 brow = q - vec3(-0.29, 0.168, 0.118); brow.xy = rot(0.28) * brow.xy;
  d = smin(d, sdEllipsoid(brow, vec3(0.19, 0.064, 0.08)), 0.05);
  d = smin(d, sdEllipsoid(q - vec3(-0.06, -0.04, 0.11), vec3(0.21, 0.13, 0.1)), 0.06);
  d = smin(d, sdEllipsoid(q - vec3(-0.5, 0.06, 0.07), vec3(0.18, 0.06, 0.06)), 0.05);
  return smax(d, -(length(q - EYE_CENTRE - vec3(0.0, 0.0, 0.02)) - EYE_RADIUS * 1.18), 0.02);
}

float lowerJaw(vec3 h) {
  vec3 j = toJaw(h);
  float d = sdRoundCone(j * vec3(1.0, 1.25, 1.2), vec3(-0.04, -0.21, 0.0), vec3(-0.67, -0.2, 0.0), 0.11, 0.06) / 1.25;
  return smin(d, sdEllipsoid(j - vec3(-0.64, -0.17, 0.0), vec3(0.07, 0.05, 0.065)), 0.04);
}

/** The red mouth lining between the jaws, narrower than the jaws so it reads recessed. */
float mouthLining(vec3 h) {
  vec3 m = h - vec3(-0.27, -0.22, 0.0); m.xy = rot(0.28) * m.xy;
  return sdEllipsoid(m, vec3(0.36, 0.12, 0.082));
}

float tongue(vec3 h) {
  return blade(h, vec3(-0.06, -0.19, 0.0), vec3(-0.42, -0.35, 0.01), vec3(-0.68, -0.3, 0.07), 0.05, vec3(0, 1, 0), 2.2);
}

/** A tooth along a jaw edge: base point, direction and length. */
float tooth(vec3 q, vec3 base, vec3 dir, float len) {
  return sdRoundCone(q, base, base + dir * len, len * 0.2 + 0.006, 0.0015);
}

float teeth(vec3 h) {
  vec3 q = vec3(h.xy, abs(h.z));
  float d = 1e5;
  for (int i = 0; i < 8; i++) {
    float x = -0.74 + float(i) * 0.075, along = (x + 0.74) / 0.62;
    float len = i == 1 ? 0.15 : (i == 0 ? 0.06 : 0.055 - along * 0.022) * (0.8 + 0.4 * hash21(vec2(i, 3)));
    float halfWidth = mix(0.06, 0.11, along), y = mix(-0.075, -0.13, along);
    d = min(d, tooth(q, vec3(x, y, halfWidth), normalize(vec3(0.12, -1.0, -0.12)), len));
  }
  vec3 j = toJaw(h); j.z = abs(j.z);
  for (int i = 0; i < 7; i++) {
    float x = -0.66 + float(i) * 0.08, along = (x + 0.66) / 0.56;
    float len = i == 1 ? 0.12 : (0.05 - along * 0.02) * (0.8 + 0.4 * hash21(vec2(i, 7)));
    float halfWidth = mix(0.045, 0.085, along), y = mix(-0.14, -0.13, along);
    d = min(d, tooth(j, vec3(x, y, halfWidth), normalize(vec3(0.15, 1.0, -0.1)), len));
  }
  return d;
}

float eyeball(vec3 h) { return length(vec3(h.xy, abs(h.z)) - EYE_CENTRE) - EYE_RADIUS; }

/** Ridged antler horns sweeping back from the skull, each with two upward tines. Returns (distance, t). */
vec2 horn(vec3 h) {
  vec3 q = vec3(h.xy, abs(h.z));
  vec3 A = vec3(-0.04, 0.2, 0.1), B = vec3(0.26, 0.44, 0.18), C = vec3(0.56, 0.48, 0.14);
  vec3 D = vec3(0.8, 0.5, 0.1), E = vec3(0.92, 0.64, 0.06);
  vec2 a = sdBezier(q, A, B, C), b = sdBezier(q, C, D, E);
  float t = a.x < b.x ? a.y * 0.6 : 0.6 + b.y * 0.4, dist = min(a.x, b.x);
  float radius = mix(0.06, 0.008, pow(t, 0.85)) * (1.0 + 0.08 * sin(t * 80.0));
  float d = (dist - radius) * 0.85;
  vec3 z = vec3(0, 0, 1);
  d = min(d, blade(q, vec3(0.24, 0.42, 0.17), vec3(0.28, 0.54, 0.16), vec3(0.24, 0.66, 0.15), 0.03, z, 1.3));
  d = min(d, blade(q, vec3(0.54, 0.47, 0.14), vec3(0.6, 0.58, 0.13), vec3(0.58, 0.7, 0.12), 0.024, z, 1.3));
  return vec2(d, t);
}

/** Spiky mane: cheek fans, the brow crest and the chin beard, head space (mirrored). */
float headMane(vec3 h) {
  vec3 q = vec3(h.xy, abs(h.z)), z = vec3(0, 0, 1);
  float d = blade(q, vec3(0.0, -0.06, 0.15), vec3(0.24, -0.08, 0.26), vec3(0.56, -0.2, 0.25), 0.05, z, 2.2);
  d = min(d, blade(q, vec3(0.04, 0.02, 0.16), vec3(0.3, 0.06, 0.25), vec3(0.62, 0.02, 0.22), 0.05, z, 2.2));
  d = min(d, blade(q, vec3(-0.06, -0.13, 0.15), vec3(0.14, -0.26, 0.23), vec3(0.4, -0.42, 0.21), 0.045, z, 2.2));
  d = min(d, blade(q, vec3(-0.18, -0.16, 0.14), vec3(-0.06, -0.32, 0.19), vec3(0.12, -0.5, 0.18), 0.04, z, 2.2));
  d = min(d, blade(q, vec3(0.0, 0.1, 0.17), vec3(0.22, 0.2, 0.24), vec3(0.52, 0.26, 0.22), 0.045, z, 2.2));
  d = min(d, blade(q, vec3(0.02, 0.18, 0.12), vec3(0.24, 0.34, 0.16), vec3(0.5, 0.44, 0.14), 0.045, z, 2.2));
  d = min(d, blade(q, vec3(-0.24, 0.2, 0.1), vec3(-0.14, 0.31, 0.12), vec3(0.0, 0.4, 0.13), 0.03, z, 1.8));
  d = min(d, blade(q, vec3(-0.12, 0.24, 0.07), vec3(-0.02, 0.38, 0.09), vec3(0.08, 0.52, 0.09), 0.032, z, 1.8));
  vec3 j = toJaw(h); j.z = abs(j.z);
  d = min(d, blade(j, vec3(-0.6, -0.24, 0.03), vec3(-0.6, -0.36, 0.05), vec3(-0.5, -0.46, 0.06), 0.035, z, 2.0));
  d = min(d, blade(j, vec3(-0.46, -0.27, 0.06), vec3(-0.42, -0.4, 0.08), vec3(-0.3, -0.5, 0.08), 0.04, z, 2.0));
  return min(d, blade(j, vec3(-0.3, -0.28, 0.07), vec3(-0.22, -0.4, 0.09), vec3(-0.08, -0.5, 0.09), 0.04, z, 2.0));
}

/** Long tapered whiskers from beside the nostrils: down and back on the near side, looping up on the far side. */
float whiskers(vec3 h) {
  vec2 a = sdBezier(h, vec3(-0.74, -0.01, 0.09), vec3(-1.0, -0.18, 0.3), vec3(-0.8, -0.46, 0.35));
  vec2 b = sdBezier(h, vec3(-0.8, -0.46, 0.35), vec3(-0.6, -0.74, 0.38), vec3(-0.86, -1.08, 0.32));
  vec2 c = sdBezier(h, vec3(-0.78, 0.02, -0.09), vec3(-0.98, 0.12, -0.2), vec3(-0.92, 0.34, -0.24));
  vec2 e = sdBezier(h, vec3(-0.92, 0.34, -0.24), vec3(-0.86, 0.54, -0.26), vec3(-0.66, 0.5, -0.26));
  float near = min(a.x - mix(0.016, 0.011, a.y), b.x - mix(0.011, 0.003, b.y));
  float far = min(c.x - mix(0.015, 0.01, c.y), e.x - mix(0.01, 0.003, e.y));
  return min(near, far);
}

/** Closest spine point: returns (distance to the axis, arc parameter 0..5, radius); centre and tangent out. */
vec3 spineAxis(vec3 p, out vec3 centre, out vec3 tangent) {
  vec2 best = vec2(1e5, 0.0); int segment = 0;
  for (int k = 0; k < 5; k++) {
    vec2 hit = sdBezier(p, SPINE[k * 2], SPINE[k * 2 + 1], SPINE[k * 2 + 2]);
    if (hit.x < best.x) { best = hit; segment = k; }
  }
  vec3 A = SPINE[segment * 2], B = SPINE[segment * 2 + 1], C = SPINE[segment * 2 + 2];
  centre = bezierAt(A, B, C, best.y);
  tangent = normalize(mix(B - A, C - B, best.y));
  float s = float(segment) + best.y;
  float radius = mix(0.14, 0.17, smoothstep(0.0, 1.5, s)) * (1.0 - 0.9 * smoothstep(2.8, 5.0, s));
  return vec3(best.x, s, radius);
}

void spineFrame(float s, out vec3 centre, out vec3 tangent) {
  int segment = min(int(s), 4); float t = s - float(segment);
  vec3 A = SPINE[segment * 2], B = SPINE[segment * 2 + 1], C = SPINE[segment * 2 + 2];
  centre = bezierAt(A, B, C, t); tangent = normalize(mix(B - A, C - B, t));
}

/** The back is always on the same side of the spine (left of the direction of travel). */
vec3 spineDorsal(vec3 tangent) { return normalize(cross(vec3(0, 0, 1), tangent)); }

/** Spiky green mane along the neck crest and dorsal spikes down the back to the tail fin. */
float backMane(vec3 p) {
  float d = 1e5;
  for (int i = 0; i < 34; i++) {
    float s = i < 12 ? 0.03 + float(i) * 0.1 : 1.2 + float(i - 12) * 0.17;
    float len = i < 12 ? mix(0.36, 0.22, float(i) / 11.0) : mix(0.13, 0.06, float(i - 12) / 21.0);
    vec3 c, along; spineFrame(min(s, 4.98), c, along);
    vec3 dorsal = spineDorsal(along);
    float radius = mix(0.14, 0.17, smoothstep(0.0, 1.5, s)) * (1.0 - 0.9 * smoothstep(2.8, 5.0, s));
    vec3 base = c + dorsal * radius * 0.75;
    base.z += i < 12 ? (mod(float(i), 2.0) - 0.5) * 0.1 + 0.04 : 0.02;
    if (length(p - base) > len + 0.08) continue;
    float wave = (hash21(vec2(i, 1)) - 0.5) * 0.2;
    vec3 mid = base + dorsal * len * 0.5 + along * len * (0.18 + wave);
    vec3 tip = base + dorsal * len * 0.7 + along * len * (0.7 + wave);
    d = min(d, blade(p, base, mid, tip, (i < 12 ? 0.05 : 0.035) * len / 0.25, vec3(0, 0, 1), 2.4));
  }
  return d;
}

/** The finned tail tip: a fan of spikes past the end of the spine. */
float tailFin(vec3 p) {
  vec3 tip = SPINE[10], z = vec3(0, 0, 1);
  float d = blade(p, tip - vec3(0.05, 0.1, 0.0), tip + vec3(0.02, 0.12, 0.02), tip + vec3(-0.1, 0.26, 0.0), 0.05, z, 2.4);
  d = min(d, blade(p, tip - vec3(0.04, 0.12, 0.0), tip + vec3(0.12, 0.06, 0.02), tip + vec3(0.14, 0.24, 0.0), 0.05, z, 2.4));
  return min(d, blade(p, tip - vec3(0.02, 0.14, 0.0), tip + vec3(0.16, -0.02, 0.02), tip + vec3(0.26, 0.08, 0.0), 0.04, z,
    2.4));
}

/** Body tube with shingle scales and segmented belly plates on the front. Returns (distance, material). */
vec2 body(vec3 p) {
  vec3 centre, tangent;
  vec3 axis = spineAxis(p, centre, tangent);
  float d = axis.x - axis.z;
  if (d > 0.05) return vec2(d, M_BODY);
  vec3 dorsal = spineDorsal(tangent), side = cross(tangent, dorsal), o = p - centre;
  vec3 bellyDir = normalize(-dorsal * 0.75 + vec3(0, 0, 1));
  if (dot(o / max(length(o), 1e-4), bellyDir) > 0.5) {
    float plate = fract(axis.y / 0.09), groove = smoothstep(0.0, 0.25, plate) * (1.0 - smoothstep(0.85, 1.0, plate));
    return vec2(d - groove * 0.008, M_BELLY);
  }
  float angle = atan(dot(o, side), dot(o, dorsal));
  vec3 scale = shingles(vec2(axis.y / 0.055, angle * axis.z / 0.055));
  return vec2(d - scale.x * 0.008, M_BODY);
}

/** A scaled leg (shoulder, elbow, wrist) ending in a four-fingered hand with hooked claws. */
vec2 leg(vec3 p, vec3 shoulder, vec3 elbow, vec3 wrist, vec2 reach, float r) {
  float d = smin(sdRoundCone(p, shoulder, elbow, r, r * 0.72), sdRoundCone(p, elbow, wrist, r * 0.72, r * 0.5), 0.04);
  if (d > 0.3) return vec2(d, M_LEG);
  float claws = 1e5;
  vec2 dir = normalize(reach);
  for (int i = 0; i < 4; i++) {
    vec2 f = rot(-0.75 + float(i) * 0.5) * dir;
    vec3 finger = vec3(f, 0.08 - float(i) * 0.04), tip = wrist + finger * 0.11, curl = vec3(-f.y, f.x, 0.0) * 0.6;
    d = smin(d, sdRoundCone(p, wrist, tip, r * 0.42, r * 0.3), 0.03);
    claws = min(claws, blade(p, tip, tip + finger * 0.05 + curl * 0.03, tip + finger * 0.04 + curl * 0.07,
      r * 0.32, vec3(0, 0, 1), 1.0));
  }
  return claws < d ? vec2(claws, M_CLAW) : vec2(d, M_LEG);
}

vec2 legs(vec3 p) {
  vec2 res = leg(p, vec3(0.02, -0.36, 0.0), vec3(-0.28, -0.3, 0.12), vec3(-0.58, -0.4, 0.16), vec2(-0.9, 0.5), 0.085);
  vec2 right = leg(p, vec3(0.7, 0.02, -0.12), vec3(0.88, -0.12, -0.04), vec3(0.9, 0.08, 0.0), vec2(0.4, 1.0), 0.08);
  vec2 hind = leg(p, vec3(-0.24, -0.78, -0.02), vec3(-0.5, -0.66, 0.08), vec3(-0.66, -0.84, 0.1), vec2(-0.7, -0.6), 0.08);
  res = right.x < res.x ? right : res;
  return hind.x < res.x ? hind : res;
}

vec2 pick(vec2 a, float d, float m) { return d < a.x ? vec2(d, m) : a; }

vec2 headParts(vec3 h) {
  float upper = upperHead(h), jaw = lowerJaw(h);
  if (min(upper, jaw) < 0.03) {
    upper -= shingles(headScaleUv(h, headCentreY(h))).x * 0.007;
    jaw -= shingles(headScaleUv(toJaw(h), -0.2)).x * 0.006;
  }
  vec2 res = vec2(smin(upper, jaw, 0.025), upper < jaw ? M_SKIN : M_JAW);
  res = pick(res, mouthLining(h), M_MOUTH);
  res = pick(res, tongue(h), M_TONGUE);
  res = pick(res, teeth(h), M_TOOTH);
  res = pick(res, eyeball(h), M_EYE);
  res = pick(res, horn(h).x, M_HORN);
  res = pick(res, headMane(h), M_MANE);
  return pick(res, whiskers(h), M_WHISKER);
}

vec2 map(vec3 p) {
  vec2 head = headParts(toHead(p)); head.x *= HEAD_SCALE;
  vec2 trunk = body(p);
  bool skin = head.y == M_SKIN || head.y == M_JAW;
  vec2 res = vec2(smin(head.x, trunk.x, skin ? 0.08 : 0.0001), head.x < trunk.x ? head.y : trunk.y);
  if (trunk.x < 0.45) res = pick(res, backMane(p), M_MANE);
  res = pick(res, tailFin(p), M_MANE);
  vec2 limbs = legs(p);
  return pick(res, limbs.x, limbs.y);
}
`;
