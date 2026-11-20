import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Nation soldier equipment in the real worker crowd and cavalry layers: per-soldier triangle
 * budgets, a 200-soldier frame-time sample and close / normal-distance contact sheets of every
 * nation's swordsman, two-handed troop, cavalry and cornered archer (idle, mid-attack, blocking),
 * attack sequences (several frames per move) and riders from four sides, on High and Minimal.
 * `npx tsx tools/bench/nation-equipment-review.ts [label]`.
 */
const label = process.argv[2] ?? "current";
const output = resolve("../resources/settlement-previews/nation-equipment");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser(true);
const reports: unknown[] = [];
try {
  for (const quality of ["high", "minimal"] as const) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/nation-equipment.html", route => route.fulfill({ contentType: "text/html",
      body: "<!doctype html><meta charset='utf-8'><body style='margin:0;background:#9aa391'>" }));
    await page.addInitScript("window.__name = value => value;");
    await page.goto(`${url}nation-equipment.html`);
    const result = await page.evaluate(async ({ quality }) => {
      const three = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
      const { createThreeWorkerCrowd, createWorkerTextureLoader } = await import(
        /* @vite-ignore */ String("/src/renderers/three/three-worker.ts"));
      const { createThreeMounts } = await import(/* @vite-ignore */ String("/src/renderers/three/three-mounts.ts"));
      const { NATION_RIDERS } = await import(/* @vite-ignore */ String("/src/render-common/mounts/nation-riders.ts"));
      const { computeEnvironment } = await import(/* @vite-ignore */ String("/src/render-common/environment.ts"));
      const detailed = quality === "high";
      const wait = (ms: number) => new Promise(done => setTimeout(done, ms));
      const renderer = new three.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
      renderer.toneMapping = three.ACESFilmicToneMapping; renderer.autoClear = false;
      renderer.setClearColor("#9aa391"); document.body.append(renderer.domElement);
      const textures = createWorkerTextureLoader(renderer);
      const environment = computeEnvironment({ azimuthX: -.6, azimuthZ: .8, elevation: .85 }, 12, 0);
      const nations = ["roman", "viking", "nubian", "japanese"] as const;
      const variants: Record<string, string> = { japanese: "japanese-man-grey", nubian: "nubian-man-kilt",
        roman: "roman-man-white", viking: "viking-man-blond" };
      const tools: Record<string, string> = { archer: "bow", heavy: "axe", shield: "sword" };
      const soldier = (nation: string, type: string, x: number, z: number, actorId: number) => ({
        actorId, nation, variant: variants[nation], x, y: 0, z, heading: 0, selected: false, visible: true,
        action: "idle_breathe", gaitPhase: 0, runBlend: 0, animationTime: .4, target: null,
        workerJob: "Soldier", workerTool: tools[type], armourRank: "soldier", carryingWare: null,
        combat: { attackProgress: null as number | null, defending: false, faction: 0, type, variant: 0,
          doorMelee: false }
      });
      const rider = (nation: string, x: number, z: number, actorId: number) => ({
        actorId, rider: NATION_RIDERS[nation], coat: "bay", nation,
        faction: 0, x, y: 0, z, heading: 0, clip: "idle", clipTime: .4, turnRate: 0,
        attackProgress: null as number | null, selected: false
      });
      const crowd = await createThreeWorkerCrowd(textures, [], detailed);
      const scenes = new Set<any>(), render = renderer.render.bind(renderer);
      renderer.render = (scene: any, view: any) => { scenes.add(scene); render(scene, view); };
      /**
       * Grip check: each hand socket's distance from the held weapon's axis (Y) and its height on
       * it. One-handed: the right hand at the origin; two-handed: the left hand 0.15 lower.
       */
      const gripErrors: { hand: string; height: number; offAxis: number; pose: string }[] = [];
      const measureGrips = (pose: string, weapon: string) => {
        for (const scene of scenes) scene.traverse((prop: any) => {
          if (prop.name !== weapon || !prop.visible || !prop.parent) return;
          const root = prop.parent, local = new three.Vector3();
          for (const [hand, socket] of [["right", "socket_hand_R"], ["left", "socket_hand_L"]] as const) {
            if (hand === "left" && prop.name !== "military_axe") continue;
            const joint = root.getObjectByName(socket);
            if (!joint) continue;
            prop.worldToLocal(joint.getWorldPosition(local));
            gripErrors.push({ hand, height: +local.y.toFixed(3),
              offAxis: +Math.hypot(local.x, local.z).toFixed(3), pose });
          }
        });
      };
      const mounts = await createThreeMounts(textures, [], detailed);
      const camera = new three.PerspectiveCamera(30, innerWidth / innerHeight, .05, 200);
      const draw = () => {
        renderer.clear(); crowd.render(renderer, camera); mounts.render(renderer, camera);
      };
      const settle = async (frames: any[], riders: any[], ready: () => boolean) => {
        for (let tick = 0; tick < 900; tick++) {
          crowd.update(frames, environment); mounts.update(riders, environment); draw();
          if (ready() && tick > (riders.length ? 12 : 6)) break;
          await wait(20);
        }
      };
      const countTriangles = async (frames: any[], riders: any[]) => {
        await settle(frames, riders, () => crowd.poolStats().instances === frames.length);
        // Riders and their armour load lazily: give them time before counting.
        for (let tick = 0; tick < (riders.length ? 80 : 6); tick++) {
          crowd.update(frames, environment); mounts.update(riders, environment); await wait(20);
        }
        camera.position.set(0, 2, 6); camera.lookAt(0, .6, 0);
        renderer.info.reset(); renderer.info.autoReset = false; draw(); renderer.info.autoReset = true;
        return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
      };
      // Budgets: the same soldier with and without its issued equipment.
      const budgets: Record<string, unknown> = {};
      for (const nation of nations) {
        for (const type of ["shield", "heavy", "archer"]) {
          const armed = soldier(nation, type, 0, 0, 1);
          const equipped = await countTriangles([armed], []);
          const bare = { ...armed, combat: undefined, workerTool: undefined };
          const unarmed = await countTriangles([bare], []);
          budgets[`${nation}-${type}`] = { calls: equipped.calls - unarmed.calls,
            soldier: equipped.triangles, equipment: equipped.triangles - unarmed.triangles };
        }
        const mounted = await countTriangles([], [rider(nation, 0, 0, 100 + nations.indexOf(nation))]);
        budgets[`${nation}-cavalry`] = { calls: mounted.calls, soldier: mounted.triangles };
      }
      await countTriangles([], []);
      // Contact sheets: one row per troop, columns are pose x distance.
      const poses = [["idle", null, false], ["attack", .62, false], ["swing", .45, false],
        ["block", null, true]] as const;
      const tile = 300, sheets: { name: string; png: string }[] = [];
      const canvas = document.createElement("canvas"), context = canvas.getContext("2d")!;
      const startSheet = (columns: number, rows: number, size: number) => {
        canvas.width = columns * size; canvas.height = rows * size;
        context.fillStyle = "#9aa391"; context.fillRect(0, 0, canvas.width, canvas.height);
      };
      /** Renders the target from `direction` at `range` and copies a centred square into a cell. */
      const capture = (target: readonly number[], range: number, direction: readonly number[], cell: number[]) => {
        const [x, y, z] = target as [number, number, number], [dx, dy, dz] = direction as [number, number, number];
        const length = Math.hypot(dx, dy, dz);
        camera.position.set(x + dx / length * range, y + dy / length * range, z + dz / length * range);
        camera.lookAt(x, y, z); camera.fov = 30; camera.updateProjectionMatrix(); draw();
        const [column, row, size] = cell as [number, number, number];
        context.drawImage(renderer.domElement, (innerWidth - innerHeight) / 2, 0, innerHeight, innerHeight,
          column * size, row * size, size, size);
      };
      const label = (text: string, column: number, row: number, size: number) => {
        context.fillStyle = "#1d2117"; context.font = "15px sans-serif";
        context.fillText(text, column * size + 6, row * size + 16);
      };
      const finish = (name: string) => sheets.push({ name, png: canvas.toDataURL("image/png").split(",")[1]! });
      const view = [.55, .45, .7];
      for (const nation of nations) {
        const frames = ["shield", "heavy", "archer"]
          .map((type, index) => soldier(nation, type, index * 4, 0, 10 + index));
        frames[2]!.combat.doorMelee = true;
        const riders = [rider(nation, 12, 0, 50 + nations.indexOf(nation))];
        startSheet(poses.length * 2, 4, tile);
        for (const [column, [name, progress, defending]] of poses.entries()) {
          for (const frame of frames) {
            frame.combat.attackProgress = progress; frame.combat.defending = defending;
            frame.combat.variant = column === 2 ? 1 : 0;
          }
          riders[0]!.attackProgress = defending ? null : progress;
          await settle(frames, riders, () => crowd.poolStats().instances === frames.length);
          const targets = [...frames.map(frame => [frame.x, .62, frame.z, 1]), [12, 1.15, 0, 1.55]] as const;
          for (const [row, [x, y, z, size]] of targets.entries()) {
            capture([x, y, z], 2.6 * size, view, [column * 2, row, tile]);
            capture([x, y, z], 9 * size, view, [column * 2 + 1, row, tile]);
          }
          label(`${name} close`, column * 2, 0, tile); label(`${name} normal`, column * 2 + 1, 0, tile);
        }
        finish(`${quality}-${nation}`);
        // Attack sequences: one row per move, several frames through the blow (and the block).
        const steps = [.15, .35, .55, .7, .8, .92];
        const rows = [["shield", 0], ["shield", 1], ["shield", 2], ["heavy", 0], ["heavy", 1], ["archer", 0],
          ["sidearm", 0], ["cavalry", 0]] as const;
        const cell = 220;
        startSheet(steps.length + 1, rows.length, cell);
        for (const [row, [kind, variant]] of rows.entries()) {
          for (let column = 0; column <= steps.length; column++) {
            const blocking = column === steps.length;
            const progress = blocking ? null : steps[column]!;
            const index = { archer: 2, cavalry: -1, heavy: 1, shield: 0, sidearm: 2 }[kind];
            for (const frame of frames) {
              frame.combat.attackProgress = progress; frame.combat.defending = blocking; frame.combat.variant = variant;
            }
            frames[2]!.combat.doorMelee = kind === "sidearm";
            riders[0]!.attackProgress = progress;
            await settle(frames, riders, () => crowd.poolStats().instances === frames.length);
            const target = index < 0 ? [12, 1.2, 0] : [frames[index]!.x, .7, 0];
            capture(target, index < 0 ? 3.4 : 2.3, [.75, .35, .9], [column, row, cell]);
            const pose = `${nation} ${kind} ${variant} ${progress ?? "block"}`;
            if (kind === "heavy") measureGrips(pose, "military_axe");
            if (kind === "shield") measureGrips(pose, "military_sword");
            if (column === 0) label(`${kind} ${variant}`, 0, row, cell);
          }
        }
        finish(`${quality}-${nation}-sequence`);
        // Riders from four sides in idle, walk, gallop, wind-up and the cut.
        const clips = [["idle", null], ["walk", null], ["gallop", null], ["idle", .35], ["idle", .78]] as const;
        const sides = [[.8, .35, .9], [-1, .3, .1], [.1, .3, -1], [1, .25, 0]];
        startSheet(clips.length, sides.length, 260);
        for (const [column, [clip, progress]] of clips.entries()) {
          Object.assign(riders[0]!, { attackProgress: progress, clip, clipTime: .2 });
          await settle([], riders, () => true);
          for (const [row, side] of sides.entries()) capture([12, 1.1, 0], 3.2, side, [column, row, 260]);
          label(`${clip}${progress === null ? "" : ` ${progress}`}`, column, 0, 260);
        }
        Object.assign(riders[0]!, { clip: "idle" });
        finish(`${quality}-${nation}-cavalry`);
      }
      // Frame time: 200 soldiers (50 per nation, mixed troops) fighting at normal camera distance.
      const army = Array.from({ length: 200 }, (_, index) => {
        const nation = nations[index % 4]!, type = ["shield", "heavy", "archer", "shield"][Math.floor(index / 4) % 4]!;
        const entry = soldier(nation, type, (index % 20) * .75 - 7, Math.floor(index / 20) * .75 - 3.5, 1000 + index);
        // The back half is hostile: its livery must read red against the player's colour.
        entry.combat.faction = index >= 100 ? 1 : 0;
        return entry;
      });
      await settle(army, [], () => crowd.poolStats().instances === army.length);
      camera.fov = 35; camera.updateProjectionMatrix();
      camera.position.set(0, 11, 11); camera.lookAt(0, 0, 0);
      const gl = renderer.getContext(), pixel = new Uint8Array(4), samples: number[] = [];
      for (let frame = 0; frame < 260; frame++) {
        const time = frame / 60;
        army.forEach((entry, index) => {
          const phase = (time * .9 + index * .137) % 1.6;
          entry.combat.attackProgress = phase < 1 ? phase : null;
          entry.combat.variant = index % 3;
        });
        const start = performance.now();
        crowd.update(army, environment); draw();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        if (frame >= 20) samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      renderer.info.reset(); renderer.info.autoReset = false; draw(); renderer.info.autoReset = true;
      const perf = { soldiers: army.length, meanMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
        medianMs: samples[Math.floor(samples.length / 2)], p95Ms: samples[Math.floor(samples.length * .95)],
        calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries,
        programs: renderer.info.programs?.length };
      const shot = renderer.domElement.toDataURL("image/png").split(",")[1]!;
      crowd.dispose(); mounts.dispose(); renderer.dispose();
      return { budgets, grips: gripErrors, perf, sheets, shot };
    }, { quality, shots: true });
    for (const entry of result.sheets)
      writeFileSync(resolve(output, `${label}-${entry.name}.png`), Buffer.from(entry.png, "base64"));
    writeFileSync(resolve(output, `${label}-${quality}-army-200.png`), Buffer.from(result.shot, "base64"));
    reports.push({ quality, budgets: result.budgets, grips: result.grips, perf: result.perf, errors });
    await page.close();
  }
  writeFileSync(resolve(output, `${label}-report.json`), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports, null, 1));
} finally { await browser.close(); await server.close(); }
