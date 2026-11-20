import { DRAGON_FRAGMENT_GLSL } from "./japanese-sail-dragon-shade";

/**
 * Browser half of tools/assets/japanese-sail-dragon.ts: ray marches the sculpt on the GPU (colour and
 * material/depth passes), inks silhouette and part edges, paints original cloud wisps behind the dragon
 * and encodes the High and Minimal assets plus a review image on linen colour.
 */
const TILE = 128;
const INK = [16, 26, 16] as const;
const FRAME = 1.15;
/** Materials of one continuous skin (head, body, jaw): no ink line where they meet. */
const SKIN_MATERIALS = new Set([1, 2, 12]);
/** Depth jump (world units over the 3-unit march range, 16-bit) that draws an overlap line. */
const DEPTH_STEP = 0.035 / 3 * 65535;

const compileProgram = (gl: WebGL2RenderingContext) => {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
    return shader;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, "#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}"));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, DRAGON_FRAGMENT_GLSL));
  gl.linkProgram(program); gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  return program;
};

/** One full pass drawn in small tiles (no GPU watchdog stall), read back top row first. */
const renderPass = (gl: WebGL2RenderingContext, program: WebGLProgram, size: number, mode: number) => {
  gl.uniform1i(gl.getUniformLocation(program, "uMode"), mode);
  gl.scissor(0, 0, size, size); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  for (let y = 0; y < size; y += TILE) for (let x = 0; x < size; x += TILE) {
    gl.scissor(x, y, TILE, TILE); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.finish();
  }
  const pixels = new Uint8Array(size * size * 4), flipped = new Uint8ClampedArray(pixels.length), row = size * 4;
  gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  for (let y = 0; y < size; y++) flipped.set(pixels.subarray(y * row, (y + 1) * row), (size - 1 - y) * row);
  return flipped;
};

const renderPasses = (size: number) => {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, premultipliedAlpha: false })!;
  const program = compileProgram(gl);
  gl.uniform2f(gl.getUniformLocation(program, "uResolution"), size, size);
  gl.enable(gl.SCISSOR_TEST);
  return { colour: renderPass(gl, program, size, 0), ids: renderPass(gl, program, size, 1) };
};

/** Seeds of ink lines: silhouette pixels, pixels behind a nearer surface and borders between parts. */
const edgeSeeds = (ids: Uint8ClampedArray, size: number) => {
  const hit = (index: number) => ids[index * 4 + 3]! > 0;
  const depth = (index: number) => ids[index * 4 + 1]! * 256 + ids[index * 4 + 2]!;
  const part = (index: number) => {
    const material = Math.round(ids[index * 4]! * 16 / 255);
    return SKIN_MATERIALS.has(material) ? 1 : material;
  };
  const silhouette = new Uint8Array(size * size), inner = new Uint8Array(size * size);
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    const index = y * size + x;
    if (!hit(index)) continue;
    for (const neighbour of [index - 1, index + 1, index - size, index + size]) {
      if (!hit(neighbour)) silhouette[index] = 1;
      else if (depth(neighbour) < depth(index) - DEPTH_STEP) inner[index] = 1;
      else if (neighbour > index && part(neighbour) !== part(index)) inner[index] = 1;
    }
  }
  return { inner, silhouette };
};

/** Dilate seeds into antialiased round-nibbed lines of the given radius (keeps the strongest cover). */
const stampLines = (ink: Float32Array, seeds: Uint8Array, size: number, radius: number) => {
  const reach = Math.ceil(radius + 1);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!seeds[y * size + x]) continue;
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const tx = x + dx, ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= size || ty >= size) continue;
      const cover = Math.min(1, Math.max(0, radius + .5 - Math.hypot(dx, dy))), target = ty * size + tx;
      if (cover > ink[target]!) ink[target] = cover;
    }
  }
};

const inkOutlines = (colour: Uint8ClampedArray, ids: Uint8ClampedArray, size: number) => {
  const { inner, silhouette } = edgeSeeds(ids, size), ink = new Float32Array(size * size), scale = size / 2048;
  stampLines(ink, silhouette, size, 4.4 * scale);
  stampLines(ink, inner, size, 2.6 * scale);
  for (let index = 0; index < size * size; index++) {
    const amount = ink[index]!, offset = index * 4;
    if (amount <= 0) continue;
    for (let channel = 0; channel < 3; channel++)
      colour[offset + channel] = colour[offset + channel]! * (1 - amount) + INK[channel]! * amount;
    colour[offset + 3] = Math.max(colour[offset + 3]!, amount * 255);
  }
};

const CLOUD_LOBES = [[-.42, .02, .2], [-.18, -.1, .27], [.12, -.14, .3], [.4, -.04, .22], [.62, .06, .14],
  [-.66, .1, .12]] as const;

/** Original cloud wisp: overlapping lobes in one inked outline, shaded grey-blue, with swirl curls. */
const paintCloud = (c: CanvasRenderingContext2D, size: number, [x, y, width, flip]: readonly number[]) => {
  const unit = width! / (2 * FRAME) * size, scale = size / 2048;
  c.save();
  c.translate((x! / FRAME * .5 + .5) * size, (.5 - y! / FRAME * .5) * size); c.scale(flip!, 1);
  const gradient = c.createLinearGradient(0, -unit * .42, 0, unit * .24);
  gradient.addColorStop(0, "#f1f3f4"); gradient.addColorStop(.55, "#b9c2c9"); gradient.addColorStop(1, "#738290");
  for (const outline of [true, false]) {
    c.beginPath();
    for (const [lx, ly, r] of CLOUD_LOBES) { c.moveTo((lx + r) * unit, ly * unit); c.arc(lx * unit, ly * unit, r * unit, 0, 7); }
    if (outline) { c.lineWidth = 8.8 * scale; c.strokeStyle = `rgb(${INK.join(",")})`; c.stroke(); }
    else { c.fillStyle = gradient; c.fill(); }
  }
  c.lineCap = "round"; c.strokeStyle = "rgba(60, 72, 82, .85)"; c.lineWidth = 4.4 * scale;
  for (const [lx, ly, r] of CLOUD_LOBES.slice(1, 4)) {
    c.beginPath(); c.arc(lx * unit, (ly + .05) * unit, r * unit * .55, Math.PI * .9, Math.PI * 1.9); c.stroke();
  }
  c.restore();
};

/** Clouds as (x, y, width, mirror) in world units: behind the claws and around the coils. */
const CLOUDS = [[-.62, -.3, .62, 1], [.78, -.2, .5, -1], [.5, -.66, .5, 1], [.82, .78, .3, -1]] as const;

const canvasOf = (size: number) => {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
  return { c: canvas.getContext("2d")!, canvas };
};

const encode = (source: HTMLCanvasElement, size: number, type: string, quality?: number) => {
  const { c, canvas } = canvasOf(size);
  c.imageSmoothingQuality = "high"; c.drawImage(source, 0, 0, size, size);
  return canvas.toDataURL(type, quality).split(",")[1]!;
};

/** Full render; returns base64 High (1024) and Minimal (512) WebP assets and a PNG review on linen. */
export const renderSailDragon = (size: number) => {
  const { colour, ids } = renderPasses(size);
  inkOutlines(colour, ids, size);
  const dragon = canvasOf(size), frame = canvasOf(size), review = canvasOf(size);
  dragon.c.putImageData(new ImageData(colour, size, size), 0, 0);
  for (const cloud of CLOUDS) paintCloud(frame.c, size, cloud);
  frame.c.drawImage(dragon.canvas, 0, 0);
  review.c.fillStyle = "#e9dcc0"; review.c.fillRect(0, 0, size, size); review.c.drawImage(frame.canvas, 0, 0);
  return {
    high: encode(frame.canvas, 1024, "image/webp", .9),
    minimal: encode(frame.canvas, 512, "image/webp", .9),
    review: review.canvas.toDataURL("image/png").split(",")[1]!
  };
};
