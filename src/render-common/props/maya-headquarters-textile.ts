type Point = readonly [number, number];
type Colour = readonly [number, number, number];
interface Embroidery { points: readonly Point[]; colour: Colour }
const JADE: Colour = [48, 142, 116], PALE: Colour = [222, 218, 166], GOLD: Colour = [211, 159, 64];
// Original modern quetzal textile: long paired tail, layered wing, crest and angular beak.
// This is authored game artwork, not a copied historical glyph or the reused circular trade badge.
const EMBROIDERY: readonly Embroidery[] = [
  { colour: JADE, points: [[.43,.48],[.52,.52],[.38,.87],[.30,.91],[.31,.78]] },
  { colour: [72,169,139], points: [[.51,.51],[.58,.55],[.49,.89],[.41,.92],[.43,.78]] },
  { colour: GOLD, points: [[.30,.89],[.39,.85],[.37,.91],[.29,.94]] },
  { colour: GOLD, points: [[.41,.90],[.49,.87],[.47,.93],[.40,.95]] },
  { colour: JADE, points: [[.35,.31],[.49,.24],[.63,.31],[.65,.47],[.55,.64],[.41,.60],[.32,.46]] },
  { colour: PALE, points: [[.35,.32],[.20,.41],[.28,.55],[.37,.60],[.47,.50],[.45,.39]] },
  { colour: [82,169,144], points: [[.32,.38],[.25,.43],[.31,.51],[.38,.55],[.41,.49]] },
  { colour: PALE, points: [[.50,.41],[.60,.39],[.60,.51],[.54,.59],[.46,.57]] },
  { colour: JADE, points: [[.51,.27],[.55,.21],[.66,.21],[.72,.28],[.69,.36],[.59,.37],[.53,.33]] },
  { colour: [84,173,143], points: [[.56,.24],[.54,.15],[.59,.19],[.63,.13],[.65,.21]] },
  { colour: GOLD, points: [[.70,.265],[.80,.315],[.70,.345],[.68,.305]] },
  { colour: [25,42,34], points: [[.647,.254],[.669,.278],[.647,.302],[.626,.278]] },
  { colour: [244,231,180], points: [[.649,.262],[.658,.274],[.647,.282],[.639,.272]] },
  { colour: GOLD, points: [[.50,.60],[.535,.61],[.56,.675],[.60,.675],[.60,.695],[.52,.695]] },
];

const inside = (x: number, y: number, points: readonly Point[]) => {
  let result = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i]!, [bx, by] = points[j]!;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) result = !result;
  }
  return result;
};
const border = (u: number, v: number) => {
  const edge = Math.min(u, 1-u, v, 1-v);
  if (edge < .025) return 0;
  if (edge < .042 || edge > .083 && edge < .092) return 1;
  if (edge >= .083) return 0;
  const along = Math.min(u, 1-u) < Math.min(v, 1-v) ? v : u;
  return (Math.floor(along * 28) + Math.floor(edge * 140)) % 3 === 0 ? 1 : 0;
};

/** Opaque woven madder cloth with a clear original quetzal embroidered in jade, ivory and ochre. */
export const paintMayaHeadquartersTextile = (size: number) => {
  const pixels = new Uint8ClampedArray(size * size * 4), heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u=(x+.5)/size,v=(y+.5)/size;
    let colour: Colour = [104,38,31], raised = false;
    if (border(u,v)) { colour=GOLD; raised=true; }
    for (const patch of EMBROIDERY) if (inside(u,v,patch.points)) { colour=patch.colour; raised=true; }
    const warp=Math.sin(x*Math.PI*.76),weft=Math.sin(y*Math.PI*.72);
    const yarn=(warp+weft)*.026+Math.sin(x*91.7+y*43.3)*.019;
    const stitch=raised?Math.sin((u*.7+v)*size*1.65)*.055:0;
    const light=.94+yarn+stitch+Math.sin(v*7.3)*.035;
    const index=(y*size+x)*4;
    pixels.set([colour[0]*light,colour[1]*light,colour[2]*light,255],index);
    heights[y*size+x]=.25+(raised?.24:0)+(warp+weft)*.055+stitch*.3;
  }
  return { heights, pixels };
};
