import assert from "node:assert/strict";

/** Diagnostic route only: the on-disk renderer and authoritative services stay untouched. */
export const patchAtmosphereLiveCost = (source: string) => {
  // The frame parameter was renamed `input` by the cinematic camera override (CIN2).
  const entry = /const render = \((frame|input)\) => \{/;
  const scalarCopy = "for (const name of SCALAR_UNIFORMS)";
  const parameter = entry.exec(source)?.[1];
  assert(parameter && source.includes(scalarCopy) && source.includes("return result;"));
  return source.replace(entry, `
    const atmosphereDebug = {
      air: 1, camera: null, captureSky: true, frozen: false, frozenFrame: null,
      lastFrame: null, manual: false, sky: null
    };
    const render = (${parameter}) => {
      if (atmosphereDebug.frozen && !atmosphereDebug.manual) return;
      atmosphereDebug.lastFrame = ${parameter};
  `).replace(scalarCopy, `
    atmosphereDebug.camera = camera;
    if (atmosphereDebug.frozen) uniformValues.uAtmospherePass = atmosphereDebug.air;
    ${scalarCopy}
  `).replace("return result;", `
    const nativeRender = renderer.render;
    renderer.render = function(passScene, passCamera) {
      const firstUniforms = passScene.children[0]?.material?.uniforms;
      const skyPass = Boolean(firstUniforms?.uInverseProjection);
      if (atmosphereDebug.skyOnly && !skyPass) return;
      if (atmosphereDebug.captureSky) {
        const skyUniforms = firstUniforms;
        if (skyUniforms?.uInverseProjection) {
          atmosphereDebug.sky = {
            airlight: Array.from(skyUniforms.uAtmosphereAirlightLinear.value),
            eye: Array.from(skyUniforms.uAtmosphereEye.value),
            pass: skyUniforms.uAtmospherePass.value,
            profile: Array.from(skyUniforms.uAtmosphereProfile.value)
          };
          atmosphereDebug.captureSky = false;
        }
      }
      return nativeRender.call(this, passScene, passCamera);
    };
    atmosphereDebug.api = result;
    atmosphereDebug.renderer = renderer;
    atmosphereDebug.addDiagnosticWorkers = frame => {
      const appearance = workerAppearances?.[0];
      if (!appearance) throw new Error("No native worker appearance is available");
      const pose = frame.exploration?.camera?.pose;
      const centerX = pose?.x ?? frame.camera.centerX;
      const centerZ = pose?.z ?? frame.camera.centerZ;
      const workers = [0, 1].map(index => {
        const x = centerX + 2 + index * 2;
        const z = centerZ + 6;
        return { ...appearance, actorId: 900001 + index, x, z,
          y: sampleSmooth(world, world.heights, x, z), heading: 0,
          action: "idle_breathe", animationTime: frame.time, gaitPhase: 0, runBlend: 0,
          selected: false, target: null, visible: true, workerJob: "Builder" };
      });
      frame.workers = [...frame.workers ?? [], ...workers];
    };
    atmosphereDebug.freeze = () => {
      atmosphereDebug.frozenFrame = atmosphereDebug.snapshotFrame(atmosphereDebug.lastFrame);
      atmosphereDebug.frozen = true;
      atmosphereDebug.captureSky = true;
    };
    atmosphereDebug.draw = () => {
      atmosphereDebug.manual = true;
      try {
        renderer.info.reset();
        render(atmosphereDebug.frozenFrame);
        atmosphereDebug.lastDraw = { draws: renderer.info.render.calls, triangles: renderer.info.render.triangles };
      }
      finally { atmosphereDebug.manual = false; }
    };
    atmosphereDebug.linkedSky = () => {
      const context = renderer.getContext();
      return (renderer.info.programs ?? []).map(program => {
        const hasUniform = name => context.getUniformLocation(program.program, name) !== null;
        let kind = null;
        if (hasUniform("uDaylight") && hasUniform("uInverseProjection")) kind = "sky";
        if (hasUniform("uRefraction") && hasUniform("uWaterField")) kind = "water";
        if (hasUniform("uGroundAlbedo")) kind = "terrain";
        if (!kind) return null;
        return { id: program.id, kind, uniforms: Object.fromEntries([
        "uAtmosphereProfile", "uAtmosphereEye", "uAtmospherePass", "uExplorationFog", "uAtmosphereAirlightLinear",
        "uAtmosphereFar"
      ].map(name => {
        const location = context.getUniformLocation(program.program, name);
        const value = location ? context.getUniform(program.program, location) : null;
        return [name, ArrayBuffer.isView(value) ? Array.from(value) : value];
      })) };
      }).filter(Boolean);
    };
    atmosphereDebug.inspect = () => ({
      binder: atmosphereMaterials.getStats(),
      buildings: (atmosphereDebug.frozenFrame ?? atmosphereDebug.lastFrame)?.buildings?.length ?? 0,
      cameraFar: atmosphereDebug.camera?.far,
      cameraPosition: atmosphereDebug.camera?.position.toArray(),
      draws: atmosphereDebug.lastDraw?.draws ?? renderer.info.render.calls,
      environment: (atmosphereDebug.frozenFrame ?? atmosphereDebug.lastFrame)?.environment,
      resources: { ...renderer.info.memory },
      seaLevel: world.seaLevel,
      sky: atmosphereDebug.sky,
      time: (atmosphereDebug.frozenFrame ?? atmosphereDebug.lastFrame)?.time,
      triangles: atmosphereDebug.lastDraw?.triangles ?? renderer.info.render.triangles,
      uniforms: Object.fromEntries([
        "uAtmosphereProfile", "uAtmosphereEye", "uAtmosphereBoundsMin", "uAtmosphereBoundsMax",
        "uAtmosphereForward", "uAtmosphereAirlightLinear", "uAtmospherePass", "uExplorationFog", "uLiveFog",
        "uAtmosphereFar", "uAtmosphereRainbow"
      ].map(name => [name, ArrayBuffer.isView(uniforms[name].value)
        ? Array.from(uniforms[name].value) : uniforms[name].value])),
      workers: (atmosphereDebug.frozenFrame ?? atmosphereDebug.lastFrame)?.workers?.length ?? 0
    });
    window.__atmosphereLiveDebug = atmosphereDebug;
    return result;
  `);
};

/** Freeze the presentation-only weather clock too; no simulation/global clock is modified. */
export const patchAtmosphereWeatherClock = (source: string) => {
  const anchor = "const now = options.now ?? defaultNow;";
  assert(source.includes(anchor));
  return source.replace(anchor, `const realNow = options.now ?? defaultNow;
    const now = () => window.__atmosphereLiveDebug?.frozen
      ? window.__atmosphereLiveDebug.frozenFrame.time * 1000 : realNow();`);
};
