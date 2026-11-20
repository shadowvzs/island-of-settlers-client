import { BufferGeometry, Float32BufferAttribute, type Group } from "three";

import { SHIP_DECK } from "../../../render-common/ships/ship-deck-layout";
import type { DeckLevels } from "./ship-hull-loft";
import type { ShipKit } from "./ship-kit";

/** Plan outline of a deck inside its hull: [z, half-beam] per hull ring, stern first. */
export type DeckOutline = readonly (readonly [number, number])[];

/** The plank underside and top (the shared deck floor), and the dark deck beams under the seams. */
export const SHIP_DECK_LEVELS: DeckLevels & { beams: number } = { beams: .165, bottom: .18, top: SHIP_DECK.floorY };

/** Plank width across the deck; Minimal lays fewer, broader planks. */
const PLANK_PITCH = { detailed: .048, minimal: .103 } as const;
/** Share of the pitch a plank covers; the rest is the dark seam between planks. */
const PLANK_COVER = .96;

/** The z where the outline, walked in from one end, first reaches half-beam `x`. */
const plankEnd = (outline: DeckOutline, x: number, bow: boolean) => {
  const last = outline.length - 1;
  const at = (index: number) => outline[bow ? last - index : index]!;
  if (at(0)[1] >= x) return at(0)[0];
  for (let index = 1; index <= last; index++) {
    const [z, width] = at(index);
    if (width < x) continue;
    const [previousZ, previousWidth] = at(index - 1);
    return previousZ + (x - previousWidth) / (width - previousWidth) * (z - previousZ);
  }
  return at(last)[0];
};

interface PlankMesh { indices: number[]; positions: number[]; uvs: number[] }

const pushVertex = (mesh: PlankMesh, position: readonly number[], uv: readonly number[]) => {
  mesh.positions.push(...position); mesh.uvs.push(...uv);
  return mesh.positions.length / 3 - 1;
};

/** One long side of a plank, facing outwards along `facing` x. */
const pushPlankSide = (mesh: PlankMesh, x: number, stern: number, bow: number, facing: 1 | -1) => {
  const { bottom, top } = SHIP_DECK_LEVELS;
  const low = pushVertex(mesh, [x, bottom, stern], [0, 0]), lowBow = pushVertex(mesh, [x, bottom, bow], [1, 0]);
  const high = pushVertex(mesh, [x, top, stern], [0, 1]), highBow = pushVertex(mesh, [x, top, bow], [1, 1]);
  if (facing > 0) mesh.indices.push(low, high, lowBow, lowBow, high, highBow);
  else mesh.indices.push(low, lowBow, high, high, lowBow, highBow);
};

/**
 * One plank between x `from` and `to`: its top runs along the keel and both ends are cut along the
 * hull outline, so it closes onto the planking instead of stopping in a stepped row of square ends.
 */
const pushPlank = (mesh: PlankMesh, outline: DeckOutline, from: number, to: number, samples: number) => {
  const xs = Array.from({ length: samples }, (_, index) => from + (to - from) * index / (samples - 1));
  if (from < 0 && to > 0 && !xs.includes(0)) xs.splice(xs.findIndex(x => x > 0), 0, 0);
  const ends = xs.map(x => [plankEnd(outline, Math.abs(x), false), plankEnd(outline, Math.abs(x), true)] as const);
  const sternMost = Math.min(...ends.map(([stern]) => stern));
  const length = Math.max(...ends.map(([, bow]) => bow)) - sternMost;
  const top = xs.map((x, index) => {
    const u = (x - from) / (to - from), [stern, bow] = ends[index]!;
    return [pushVertex(mesh, [x, SHIP_DECK_LEVELS.top, stern], [u, (stern - sternMost) / length]),
      pushVertex(mesh, [x, SHIP_DECK_LEVELS.top, bow], [u, (bow - sternMost) / length])] as const;
  });
  for (let index = 0; index + 1 < top.length; index++) {
    const [stern, bow] = top[index]!, [nextStern, nextBow] = top[index + 1]!;
    mesh.indices.push(stern, bow, nextStern, nextStern, bow, nextBow);
  }
  pushPlankSide(mesh, from, ends[0]![0], ends[0]![1], -1);
  pushPlankSide(mesh, to, ends.at(-1)![0], ends.at(-1)![1], 1);
};

const indexedGeometry = (positions: number[], uvs: number[], indices: number[]) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
};

/** Long deck planks across the whole outline, every plank end cut to the hull. */
const deckPlanks = (outline: DeckOutline, detailed: boolean) => {
  const widest = Math.max(...outline.map(([, width]) => width));
  const pitch = detailed ? PLANK_PITCH.detailed : PLANK_PITCH.minimal;
  const count = Math.max(1, Math.round(widest * 2 / pitch)), step = widest * 2 / count;
  const mesh: PlankMesh = { indices: [], positions: [], uvs: [] };
  for (let plank = 0; plank < count; plank++) {
    const middle = -widest + step * (plank + .5), half = step * PLANK_COVER / 2;
    pushPlank(mesh, outline, middle - half, middle + half, detailed ? 3 : 2);
  }
  return indexedGeometry(mesh.positions, mesh.uvs, mesh.indices);
};

/** The dark deck beams seen through the plank seams, filling the same outline. */
const deckBeams = (outline: DeckOutline) => {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  outline.forEach(([z, width], ring) => {
    positions.push(-width, SHIP_DECK_LEVELS.beams, z, width, SHIP_DECK_LEVELS.beams, z);
    uvs.push(0, ring / 4, 1, ring / 4);
    if (ring < outline.length - 1) { const a = ring * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  });
  return indexedGeometry(positions, uvs, indices);
};

/** The shared working deck (every nation's hull): beams and long planks filling `outline` to the skin. */
export const addShipDeck = (kit: ShipKit, planking: Group, outline: DeckOutline) => {
  kit.mesh(planking, "dark", kit.temp(deckBeams(outline)));
  kit.mesh(planking, "deck", kit.temp(deckPlanks(outline, kit.detailed)));
};
