import { rotateAroundUp } from "../../src/render-common/camera-state";
import { ISO_PITCH } from "../../src/render-common/iso-projection";
import { snapshotAtmosphereFrame } from "./atmosphere-frame-snapshot";
import { measureAtmosphereGpu } from "./atmosphere-gpu";

const debug = () => (window as any).__atmosphereLiveDebug;
const empty = () => [][Symbol.iterator]();

/** Home generation intentionally uses softwoods; add one legal editor oak in this isolated review world. */
export const addWinterFixture = async () => {
  const current = debug(), world = current.world;
  if (Array.from({ length: world.props.count }, (_, id) => id).some(id => world.props.types[id] === 0))
    return { added: false, identity: current.identity };
  const { checkPropSpot, placeProp } = await import(
    /* @vite-ignore */ String("/src/shared/world/editing/prop-placement.ts"));
  const first = world.props.count;
  for (let z = 24; z < 104; z += 2) for (let x = 24; x < 104; x += 2) {
    if (checkPropSpot(world, 0, x + .5, z + .5)) continue;
    const result = placeProp(world, { ageSeconds: 1e6, kind: 0, seed: 7, x: x + .5, z: z + .5 });
    if (typeof result !== "number") continue;
    current.api.mapEdit.refreshPlacedProps(first);
    return { added: true, identity: current.identity, propId: result };
  }
  throw new Error("No legal editor oak position in the review world");
};

/** Diagnostic presentation pinning only; production source and persisted world arrays stay untouched. */
export const prepareWinterFrame = async () => {
  const current = debug(), live = (window as any).__settlement;
  if (live) {
    const held = live.update(0);
    live.update = () => held;
  }
  await current.vegetation.ready;
  const previous = (window as any).__winterFrozenTemplate;
  const frame = snapshotAtmosphereFrame(previous ?? current.lastFrame);
  frame.time = 42;
  frame.exploration = undefined;
  frame.environment.rain = 0;
  frame.environment.snow = 0;
  for (const field of ["workers", "buildings", "shipPreviewWorkers", "ships", "shipSites", "shuttleBoats",
    "marbleDeposits", "adventureCamps", "militaryArrows", "militaryDeaths", "transportHorses", "handcarts",
    "territoryBorders", "fields", "mounts", "cavalryMounts"])
    (frame as any)[field] = [];
  for (const field of ["rallyBanner", "placementGhost", "placementPreviews", "roadPreview"])
    (frame as any)[field] = null;
  for (const field of ["animals", "birds", "butterflies", "critters"])
    (frame as any)[field].count = 0;
  frame.critters.ripples.count = 0;
  const standing = frame.felling.getState(-1);
  frame.felling.leaves.alpha.fill(0);
  frame.felling = { ...frame.felling, felledIds: empty, getState: () => standing };
  frame.growth = { growing: empty, grownIds: empty, isGrown: () => false,
    isGrowing: () => false, revision: () => 0 };
  (window as any).__winterFrozenTemplate = frame;
  current.frozen = true;
  current.frozenFrame = frame;
  current.renderer.info.autoReset = false;
  await current.api.prepareFrame(frame);
  current.draw();
  const props = current.world.props;
  const candidates = Array.from({ length: props.count }, (_, id) => id).filter(id =>
    [0, 18, 21, 23, 24].includes(props.types[id]) && props.x[id] > 14 && props.z[id] > 14 &&
    props.x[id] < current.world.cellsX - 14 && props.z[id] < current.world.cellsZ - 14);
  candidates.sort((a, b) => props.scale[b] - props.scale[a]);
  const id = candidates[0];
  if (id === undefined) throw new Error("The native winter fixture has no interior broadleaf tree");
  current.subject = { id, type: props.types[id], x: props.x[id], z: props.z[id], form: props.form[id] };
  return { identity: current.identity, subject: current.subject, visualWinter: current.visualWinter };
};

const digest = async (buffer: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)))
  .map(value => value.toString(16).padStart(2, "0")).join("");

/** Exact terrain, navigation, resource and prop bytes; excludes transient revision metadata. */
export const hashWinterWorld = async () => {
  const { world } = debug(), result: Record<string, string> = {};
  for (const [owner, value] of [["world", world], ["props", world.props]] as const) {
    for (const key of Object.keys(value).sort()) {
      const array = value[key];
      if (!ArrayBuffer.isView(array)) continue;
      let byteLength = array.byteLength;
      if (owner === "props" && "BYTES_PER_ELEMENT" in array)
        byteLength = world.props.count * Number(array.BYTES_PER_ELEMENT);
      const bytes = new Uint8Array(array.buffer, array.byteOffset, byteLength);
      result[`${owner}.${key}`] = await digest(bytes.slice().buffer);
    }
  }
  return result;
};

/** Two actual water bodies from the river-enabled fixture; no terrain or flow data is edited. */
export const prepareWinterWaterViews = () => {
  const current = debug(), world = current.world, stride = world.cellsX + 1;
  let coast: { score: number; x: number; z: number } | undefined;
  let river: { score: number; x: number; z: number } | undefined;
  for (let z = 16; z < world.cellsZ - 16; z++) for (let x = 16; x < world.cellsX - 16; x++) {
    const vertex = z * stride + x, distance = world.coastDistance[vertex];
    if (distance > .2 && distance < 1.8 && world.waterDepth[vertex] <= .015) {
      const score = world.splat[vertex * 9 + 4];
      if (!coast || score > coast.score) coast = { score, x, z };
    }
    const flow = Math.hypot(world.flow[vertex * 2], world.flow[vertex * 2 + 1]);
    if (flow > .05 && world.waterDepth[vertex] > .1 && world.heights[vertex] > world.seaLevel + .1) {
      const score = flow * 100 - Math.hypot(x - world.cellsX / 2, z - world.cellsZ / 2);
      if (!river || score > river.score) river = { score, x, z };
    }
  }
  if (!coast || !river) throw new Error("Winter water review requires a real sandy coast and flowing river");
  current.waterSubjects = { normal: { ...coast, kind: "coast" }, close: { ...river, kind: "river" } };
  return current.waterSubjects;
};

export const reviewWinterView = async (view: "normal" | "close", timed: boolean) => {
  const current = debug();
  const subject = current.waterSubjects?.[view] ?? current.subject;
  let centerX = subject.x, centerZ = subject.z;
  if (current.waterSubjects) {
    const world = current.world, vertex = Math.round(subject.z) * (world.cellsX + 1) + Math.round(subject.x);
    const height = world.waterSurface[vertex];
    const direction = rotateAroundUp(Math.SQRT1_2, Math.SQRT1_2, .5);
    const distance = height / Math.tan(ISO_PITCH - .2);
    centerX -= direction.x * distance; centerZ -= direction.z * distance;
  }
  Object.assign(current.frozenFrame.camera, { centerX, centerZ,
    zoom: view === "close" ? 3.5 : .9, yaw: .5, tilt: -.2 });
  await current.api.prepareFrame(current.frozenFrame);
  // Hidden preparation briefly samples an FPS view; settle all pending terrain LODs and return
  // through the real iso hysteresis boundary so every reinstall starts from identical full indices.
  current.frozenFrame.camera.zoom = .4;
  for (let warm = 0; warm < 32; warm++) current.draw();
  current.frozenFrame.camera.zoom = 3.5;
  current.draw();
  current.frozenFrame.camera.zoom = view === "close" ? 3.5 : .9;
  current.draw();
  const gl = current.renderer.getContext() as WebGL2RenderingContext;
  const extension = gl.getExtension("WEBGL_debug_renderer_info");
  const programs = [];
  const samplerTypes: readonly number[] = [gl.SAMPLER_2D, gl.SAMPLER_CUBE, gl.SAMPLER_2D_SHADOW,
    gl.SAMPLER_2D_ARRAY, gl.INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_2D];
  for (const program of current.renderer.info.programs ?? []) {
    const shaders = gl.getAttachedShaders(program.program) ?? [];
    const sources = shaders.map(shader => `${gl.getShaderParameter(shader, gl.SHADER_TYPE)}:${gl.getShaderSource(shader)}`)
      .sort().join("\n");
    const samplers = [];
    for (let index = 0; index < gl.getProgramParameter(program.program, gl.ACTIVE_UNIFORMS); index++) {
      const uniform = gl.getActiveUniform(program.program, index);
      if (uniform && samplerTypes.includes(uniform.type))
        samplers.push({ name: uniform.name, size: uniform.size, type: uniform.type });
    }
    const operations = sources.replace(
      /const vec3 WATER_(ABSORPTION|SCATTER_SHALLOW|SCATTER_DEEP) = vec3\([^)]*\);/g,
      "const vec3 WATER_$1 = SEASONAL_COLOUR;"
    );
    programs.push({ linked: Boolean(gl.getProgramParameter(program.program, gl.LINK_STATUS)),
      samplers: samplers.sort((a, b) => a.name.localeCompare(b.name)),
      operationHash: await digest(new TextEncoder().encode(operations).buffer),
      sourceHash: await digest(new TextEncoder().encode(sources).buffer) });
  }
  const timing = timed ? await measureAtmosphereGpu(current.renderer, current.draw, 12) : null;
  current.draw();
  const terrain = current.terrain.ground.children.map((mesh: any) => {
    const attributes = mesh.geometry.attributes;
    let snow = 0, green = 0, shallow = 0, invalid = 0;
    const dryLowlands = [];
    for (let vertex = 0; vertex < attributes.position.count; vertex++) {
      const weight = attributes.splatB.array[vertex * 4 + 2];
      snow += weight;
      green += attributes.splatA.array[vertex * 4] + attributes.splatA.array[vertex * 4 + 1] +
        attributes.splatA.array[vertex * 4 + 2];
      const depth = attributes.water.array[vertex * 4];
      const coast = attributes.water.array[vertex * 4 + 1];
      shallow += Number(depth > -.8);
      invalid += Number(!Number.isFinite(depth));
      if (coast >= 2 && depth <= .015 && depth > -.8 && dryLowlands.length < 3)
        dryLowlands.push({ depth, coast, snow: weight, x: attributes.position.array[vertex * 3],
          z: attributes.position.array[vertex * 3 + 2] });
    }
    return { origin: [attributes.position.array[0], attributes.position.array[2]],
      dryLowlands, green, snow, shallow, invalid, indices: mesh.geometry.drawRange.count };
  });
  const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
  gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const references = (window as any).__winterPixelReferences ??= {};
  if (!references[view] && !current.visualWinter) references[view] = pixels.slice();
  const reference = references[view] as Uint8Array;
  let maximum = 0, total = 0, changedChannels = 0;
  for (let offset = 0; offset < pixels.length; offset++) {
    if (offset % 4 === 3) continue;
    const difference = Math.abs(pixels[offset]! - reference[offset]!);
    maximum = Math.max(maximum, difference);
    total += difference;
    changedChannels += Number(difference > 0);
  }
  const pixelComparison = { changedChannels, maximum, meanAbsolute: total / (pixels.length * .75) };
  return { buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    draws: current.lastDraw.draws, identity: current.identity, pixelComparison, pixelHash: await digest(pixels.buffer),
    programs: programs.sort((a, b) => a.sourceHash.localeCompare(b.sourceHash)),
    renderer: gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
    resources: { ...current.renderer.info.memory }, terrain, timing, triangles: current.lastDraw.triangles,
    subject, view, visualWinter: current.visualWinter };
};
