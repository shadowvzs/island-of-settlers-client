import { BufferGeometry, Float32BufferAttribute } from "three";

import { type HidePoint,stretchedHideOutline } from "../../../render-common/buildings/stretched-hide-outline";
import { lerp3, scale3, smoothstep } from "../../../shared/world/noise";

/**
 * One continuous hide laced into a frame: flesh side (+Z) cream-tan and mottled, darkening to
 * brown where the fur wraps round the edge; hair side (-Z) brown with a darker spine. A thin
 * rim gives it thickness, the middle sags back and (on High) the skin carries shallow wrinkles.
 * The "hide" material maps flesh fibres on the left half of its texture and fur on the right.
 */
type Colour = readonly [number, number, number];

const HIGH = { edge: 48, rings: [.36, .7, 1] } as const;
const MINIMAL = { edge: 26, rings: [1] } as const;
const HALF_THICKNESS = .12;
const FLESH: Colour = [.98, .86, .68];
const FLESH_WARM: Colour = [.86, .66, .46];
const FLESH_EDGE: Colour = [.5, .34, .21];
const HAIR: Colour = [.47, .31, .18];
const HAIR_SPINE: Colour = [.3, .19, .11];


/** Sag back from the flesh side, deepest low in the hide, plus shallow skin wrinkles. */
const midSurface = (x: number, y: number, ring: number, wrinkled: boolean) => {
  // Measured on the trunk, so the leg flaps stay flat and taut instead of creasing along their spokes.
  const sag = -.42 * Math.exp(-(x * x / .05 + y * y / .1)) * (1 - y * .5);
  const wrinkle = wrinkled ? .05 * ring * (Math.sin(x * 23 + Math.sin(y * 9) * 1.5) * .6 +
    Math.sin(y * 17 + x * 4 + 1.2) * .4) : 0;
  return sag + wrinkle;
};

/** Blotchy flesh-side mottling: scraped patches and fat residue, never a flat colour. */
const fleshColour = (x: number, y: number, ring: number): Colour => {
  const mottle = 1 + .06 * Math.sin(x * 9 + 1.3) * Math.sin(y * 7 + .4) + .04 * Math.sin(x * 17 - y * 13 + .8);
  const warmth = smoothstep(-.2, .9, Math.sin(x * 6 + y * 4 + .7) * Math.sin(y * 5 - 1.1));
  const skin = lerp3(lerp3(FLESH, FLESH_WARM, warmth * .55 + ring * .2), FLESH_EDGE, smoothstep(.62, 1, ring));
  return scale3(skin, mottle);
};

const hairColour = (x: number, y: number): Colour => {
  const spine = Math.exp(-((x / .11) ** 2)) * smoothstep(-.45, -.1, y) * (1 - smoothstep(.3, .48, y));
  const variation = 1 + .06 * Math.sin(y * 23 + x * 5) + .04 * Math.sin(x * 31);
  return scale3(lerp3(HAIR, HAIR_SPINE, spine * .8), variation);
};

class HideMeshBuilder {
  readonly positions: number[] = [];
  readonly uvs: number[] = [];
  readonly colours: number[] = [];
  readonly indices: number[] = [];

  vertex(x: number, y: number, z: number, u: number, colour: Colour) {
    this.positions.push(x, y, z);
    this.uvs.push(u, y + .5);
    this.colours.push(...colour);
    return this.positions.length / 3 - 1;
  }

  /** Centre fan plus one quad strip per ring; `front` faces +Z, otherwise -Z. */
  face(outline: readonly HidePoint[], rings: readonly number[], front: boolean, wrinkled: boolean) {
    const side = front ? 1 : -1, uOffset = front ? .02 : .52;
    const add = (x: number, y: number, ring: number) => this.vertex(x, y,
      midSurface(x, y, ring, wrinkled) + side * HALF_THICKNESS, uOffset + (x + .5) * .46,
      front ? fleshColour(x, y, ring) : hairColour(x, y));
    const centre = add(0, 0, 0), count = outline.length;
    let inner: number[] = [];
    for (const ring of rings) {
      const outer = outline.map(([x, y]) => add(x * ring, y * ring, ring));
      for (let index = 0; index < count; index++) {
        const next = (index + 1) % count;
        if (!inner.length) this.triangle(front, centre, outer[next]!, outer[index]!);
        else {
          this.triangle(front, inner[index]!, outer[next]!, outer[index]!);
          this.triangle(front, inner[index]!, inner[next]!, outer[next]!);
        }
      }
      inner = outer;
    }
  }

  /** The cut edge: a narrow band facing outwards, hair-coloured where the fur turns over. */
  rim(outline: readonly HidePoint[]) {
    const fleshSide = outline.map(([x, y]) => this.vertex(x, y, midSurface(x, y, 1, true) + HALF_THICKNESS,
      .5, FLESH_EDGE));
    const hairSide = outline.map(([x, y]) => this.vertex(x, y, midSurface(x, y, 1, true) - HALF_THICKNESS,
      .5, HAIR));
    for (let index = 0; index < outline.length; index++) {
      const next = (index + 1) % outline.length;
      this.indices.push(fleshSide[index]!, hairSide[next]!, hairSide[index]!,
        fleshSide[index]!, fleshSide[next]!, hairSide[next]!);
    }
  }

  private triangle(front: boolean, a: number, b: number, c: number) {
    if (front) this.indices.push(a, b, c);
    else this.indices.push(a, c, b);
  }
}

/** Depth is remapped into the unit box, so the part's z size sets thickness plus sag. */
const fitDepthToUnitBox = (positions: number[]) => {
  const depths = positions.filter((_, index) => index % 3 === 2);
  const minimum = Math.min(...depths), range = Math.max(...depths) - minimum;
  for (let index = 2; index < positions.length; index += 3)
    positions[index] = (positions[index]! - minimum) / range - .5;
};

export const createStretchedHideGeometry = (detailed: boolean) => {
  const { edge, rings } = detailed ? HIGH : MINIMAL;
  const outline = stretchedHideOutline(edge), builder = new HideMeshBuilder();
  builder.face(outline, rings, true, detailed);
  builder.face(outline, rings, false, detailed);
  if (detailed) builder.rim(outline);
  fitDepthToUnitBox(builder.positions);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(builder.positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(builder.uvs, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(builder.colours, 3));
  geometry.setIndex(builder.indices);
  geometry.computeVertexNormals();
  return geometry;
};
