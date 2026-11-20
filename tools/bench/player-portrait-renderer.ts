/**
 * In-page renderer of the animated HUD portrait sheets (`assets/ui-icons/portraits/<nation>-<gender>.webp`)
 * and their face crops (`.../faces/<nation>-<gender>.webp`), shared by the exporter
 * `tools/bench/player-portraits.ts` and the icon comparison `tests-ui/visual/ui-icons.spec.ts`.
 * Runs inside the page through `page.evaluate`, so it must stay self-contained (dynamic imports only).
 */
import {
  PLAYER_AVATAR_BODIES,
  PLAYER_AVATAR_GENDERS,
  type PlayerAvatarGender
} from "../../src/render-common/workers/player-avatar";
import { WORKER_NATIONS } from "../../src/render-common/workers/worker-appearance";
import type { WorkerNation } from "../../src/render-common/workers/worker-unit";

export interface PortraitSubject {
  gender: PlayerAvatarGender;
  /** File stem shared by the HUD sheet, face crop and visual comparison. */
  key: string;
  nation: WorkerNation;
  variant: string;
}

/** Every nation×gender pair; the canonical body ids come only from the shared table. */
export const PORTRAITS: readonly PortraitSubject[] = WORKER_NATIONS.flatMap(nation =>
  PLAYER_AVATAR_GENDERS.map(gender => {
    const { variant } = PLAYER_AVATAR_BODIES[nation][gender];
    return { gender, key: `${nation}-${gender}`, nation, variant };
  }));

/**
 * 120 frames in 10 columns x 12 rows (WebP allows 16,383 px per side, so one row capped frames at
 * 128 px). Frames are 2x the 92 px HUD portrait for high-DPI screens, each rendered at 2x again
 * and downsampled. 192 px keeps the decoded sheet at 17.7 MB (224 px: 24 MB, 18 % larger files).
 */
export const FRAMES = 120, COLUMNS = 10, SIZE = 192, QUALITY = .9;
/**
 * Clip, seconds shown (10 s = 120 frames at 12 fps); the wave plays out its lowering, and the last breathe
 * crossfades back into the first frame.
 */
export const SEQUENCE = [
  ["idle_breathe", 1.5], ["look_around", 3], ["greet_wave", 2.9], ["talk", 1.6], ["idle_breathe", 1]
] as const;
export interface PortraitSheetOptions {
  columns: number;
  frames: number;
  portraits: readonly PortraitSubject[];
  quality: number;
  sequence: typeof SEQUENCE;
  size: number;
}

/** The exporter's arguments: one sheet and one face crop per nation×gender. */
export const PORTRAIT_SHEET_OPTIONS: PortraitSheetOptions = {
  columns: COLUMNS, frames: FRAMES, portraits: PORTRAITS, quality: QUALITY, sequence: SEQUENCE, size: SIZE
};

export const renderPortraitSheets = async ({
  columns, frames, portraits, quality, sequence, size
}: PortraitSheetOptions) => {
  // Crop rectangle in frame units: head, hair and shoulders from the same rendered frame. It stays
  // inside the serialized function because page.evaluate cannot see module-level constants.
  const faceCrop = { left: 0.25, size: 0.5, top: 1 / 6 };
  const three = await import(/* @vite-ignore */ String("/@id/three"));
  const { RoomEnvironment } = await import(
    /* @vite-ignore */ String("/@id/three/examples/jsm/environments/RoomEnvironment.js"));
  const { createWorkerTextureLoader } = await import(/* @vite-ignore */ String("/src/renderers/three/three-worker.ts"));
  const { ThreeWorkerPack } = await import(
    /* @vite-ignore */ String("/@fs/home/shadowvzs/personal/island of settlers/game/island-of-settlers-worker-generation/src/game-three-worker.ts"));
  const renderer = new three.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(size * 2, size * 2); renderer.setPixelRatio(1); renderer.setClearColor(0, 0);
  renderer.toneMapping = three.ACESFilmicToneMapping; renderer.outputColorSpace = three.SRGBColorSpace;
  const scene = new three.Scene();
  const pmrem = new three.PMREMGenerator(renderer), room = new RoomEnvironment();
  const reflection = pmrem.fromScene(room, .04); scene.environment = reflection.texture;
  scene.environmentIntensity = .6; room.dispose(); pmrem.dispose();
  scene.add(new three.HemisphereLight(0xfff0dc, 0x524a35, 1.3));
  const key = new three.DirectionalLight(0xffefd8, 2.6); key.position.set(-1.5, 2.5, 3); scene.add(key);
  const rim = new three.DirectionalLight(0xbfd8ff, 1.4); rim.position.set(2, 2, -2); scene.add(rim);
  const camera = new three.PerspectiveCamera(22, 1, .05, 20);
  const textures = createWorkerTextureLoader(renderer);
  const pack = new ThreeWorkerPack(new URL("workers/tripo/", location.href).href, textures);
  const sheet = document.createElement("canvas");
  sheet.width = size * columns; sheet.height = size * Math.ceil(frames / columns);
  const context = sheet.getContext("2d")!;
  context.imageSmoothingQuality = "high";
  const face = document.createElement("canvas");
  face.width = face.height = size;
  const faceContext = face.getContext("2d")!;
  faceContext.imageSmoothingQuality = "high";
  const result: Record<string, string> = {}, faces: Record<string, string> = {};
  const durations: Record<string, number[]> = {};
  for (const portrait of portraits) {
    const worker = await pack.load(portrait.nation, portrait.variant);
    scene.add(worker.root);
    const clipNamed = (name: string) => worker.clips.find((entry: any) => entry.name === name) ?? worker.clips[0];
    // Every segment owns its action: a clip used twice (the opening and closing breathe) must not
    // share one action, or setting the second overwrites the first's time and weight mid-fade.
    const segments = sequence.map(([name, seconds]) => {
      const action = worker.mixer.clipAction(clipNamed(name).clone());
      action.play(); action.setEffectiveWeight(0);
      return { action, duration: action.getClip().duration as number, seconds };
    });
    durations[portrait.key] = segments.map(segment => Number(segment.duration.toFixed(2)));
    const starts = segments.reduce((list: number[], _segment, index) =>
      [...list, index ? list[index - 1]! + segments[index - 1]!.seconds : 0], []);
    const total = starts.at(-1)! + segments.at(-1)!.seconds;
    const fade = .4;
    /** A clip that runs out holds its last pose; wrapping to its start would snap the pose back. */
    const show = (index: number, elapsed: number, weight: number) => {
      segments[index]!.action.time = Math.min(elapsed, segments[index]!.duration);
      segments[index]!.action.setEffectiveWeight(weight);
    };
    /**
     * Pose at loop time t: each segment fades in over the previous one, still playing on. The
     * last segment fades into the first segment's opening frame, so the loop wraps seamlessly.
     */
    const pose = (time: number) => {
      const index = starts.findLastIndex(start => start <= time);
      const local = time - starts[index]!, last = index === segments.length - 1;
      segments.forEach(segment => segment.action.setEffectiveWeight(0));
      const blend = index ? Math.min(1, local / fade) : 1;
      const closing = last ? Math.max(0, (local - (segments[index]!.seconds - fade)) / fade) : 0;
      show(index, local, blend * (1 - closing));
      if (blend < 1) show(index - 1, time - starts[index - 1]!, 1 - blend);
      if (closing > 0) show(0, 0, closing);
      worker.mixer.update(0); worker.root.updateMatrixWorld(true);
    };
    pose(0);
    let head: any;
    worker.root.traverse((object: any) => { if (!head && /head/i.test(object.name) && object.isBone) head = object; });
    const target = new three.Vector3();
    (head ?? worker.root).getWorldPosition(target);
    target.y += head ? .02 : 1.55;
    // Wider bust framing: the crown, the shoulders and a waving hand all fit the frame.
    camera.position.set(target.x + .22, target.y + .1, target.z + 1.5); camera.lookAt(target.x, target.y - .03, target.z);
    context.clearRect(0, 0, sheet.width, sheet.height);
    faceContext.clearRect(0, 0, size, size);
    for (let frame = 0; frame < frames; frame++) {
      pose(total * frame / frames);
      renderer.render(scene, camera);
      const column = frame % columns, row = Math.floor(frame / columns);
      context.drawImage(renderer.domElement, column * size, row * size, size, size);
      if (frame) continue;
      // The face is the same pose/frame as cell 0 of the sheet, cropped before the sheet downsample.
      const crop = size * faceCrop.size;
      faceContext.drawImage(renderer.domElement, size * faceCrop.left * 2, size * faceCrop.top * 2,
        crop * 2, crop * 2, 0, 0, size, size);
    }
    result[portrait.key] = sheet.toDataURL("image/webp", quality).split(",")[1]!;
    faces[portrait.key] = face.toDataURL("image/webp", quality).split(",")[1]!;
    // The next nation×gender render must not show this body behind it.
    scene.remove(worker.root);
    worker.dispose();
  }
  pack.dispose(); textures.dispose(); reflection.dispose(); renderer.dispose();
  return { durations, faces, result };
};
