import { ExtrudeGeometry, Shape } from "three";

/** Flat carved caudal fin: narrow attached root and a real concave fork, identical on both LODs. */
export const createRomanFishTail = () => {
  const outline = new Shape();
  outline.moveTo(-.5, .1);
  outline.lineTo(-.28, .12);
  outline.lineTo(.5, .5);
  outline.lineTo(.12, 0);
  outline.lineTo(.5, -.5);
  outline.lineTo(-.28, -.12);
  outline.lineTo(-.5, -.1);
  outline.closePath();
  const geometry = new ExtrudeGeometry(outline, { depth: 1, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, -.5);
  return geometry;
};
