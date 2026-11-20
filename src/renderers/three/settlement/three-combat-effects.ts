import { CanvasTexture, ConeGeometry, CylinderGeometry, Group,
  Mesh, MeshStandardMaterial, Quaternion, Sprite, SpriteMaterial, Vector3 }
  from "three";

import {
  DEATH_SMOKE_DEPTH_BIAS, deathSmokeBody, deathSmokePuff, deathSmokePuffCount, type MilitaryDeathFrame
} from "../../../render-common/settlement/death-smoke";
import { ENEMY_FACTION_COLOR, NEUTRAL_FACTION_COLOR } from "../../../render-common/settlement/player-color";
import { CATAPULT_IMPACT_RADIUS } from "../../../shared/settlement/military-catapult-impact";
import type { MilitaryArrow } from "../../../shared/settlement/military-projectiles";
import { tintCatapultMaterial } from "../buildings/catapult-ammo-material";
import { createMarbleShotKit } from "../buildings/catapult-marble-shot";
import { createCatapultRockGeometry, createCatapultRockMaterial, disposeCatapultRockMaterial } from "../buildings/catapult-rock-geometry";

/**
 * A fallen unit leaves smoke in its player's colour: the player's own for
 * faction 0, the enemy's for hostile factions, grey for neutral units. Lifted towards white so
 * the puff still reads as smoke.
 */
const smokeColor = (faction: number | undefined, player: readonly [number, number, number]) => {
  let base: readonly [number, number, number] = ENEMY_FACTION_COLOR;
  if (faction === undefined) base = NEUTRAL_FACTION_COLOR;
  else if (faction === 0) base = player;
  return base.map(channel => .35 + channel * .65) as [number, number, number];
};

/** Billows around a soft core, so overlapping puffs read as smoke rather than one smooth blob. */
const SMOKE_LOBES = [[0, 0, 15], [-11, -6, 11], [10, -8, 12], [-7, 9, 10], [9, 8, 11], [0, -13, 9], [-14, 3, 8]];
const createSmokeTexture = () => {
  const size = 64, canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!, centre = size / 2;
  const core = context.createRadialGradient(centre, centre, 0, centre, centre, centre);
  core.addColorStop(0, "rgba(222,226,224,0.55)");
  core.addColorStop(.5, "rgba(205,212,209,0.35)");
  core.addColorStop(1, "rgba(185,197,192,0)");
  context.fillStyle = core; context.fillRect(0, 0, size, size);
  for (const [dx, dy, radius] of SMOKE_LOBES) {
    const x = centre + dx!, y = centre + dy!, lobe = context.createRadialGradient(x, y, 0, x, y, radius!);
    lobe.addColorStop(0, "rgba(232,235,233,0.5)");
    lobe.addColorStop(.6, "rgba(214,220,217,0.3)");
    lobe.addColorStop(1, "rgba(200,208,205,0)");
    context.fillStyle = lobe; context.fillRect(0, 0, size, size);
  }
  return new CanvasTexture(canvas);
};

/** Smoke puff material: its quad is pulled towards the camera (see DEATH_SMOKE_DEPTH_BIAS). */
const createSmokeMaterial = (map: CanvasTexture) => {
  const material = new SpriteMaterial({ depthWrite: false, map, opacity: 0, transparent: true });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace("mvPosition.xy += rotatedPosition;",
      `mvPosition.xy += rotatedPosition;\n\tmvPosition.z += ${DEATH_SMOKE_DEPTH_BIAS.toFixed(3)} * scale.x;`);
  };
  material.customProgramCacheKey = () => "military-death-smoke";
  return material;
};

/** Short-lived visual effects do not own actors, target references or population. */
export const createThreeCombatEffects = (detailed: boolean) => {
  const root = new Group(); root.name = "military-combat-effects";
  /** Death smoke draws after the soldiers and horses (its own pass), so it veils the fallen figure. */
  const smoke = new Group(); smoke.name = "military-death-smoke";
  const shaftGeometry = new CylinderGeometry(.006, .006, .44, detailed ? 6 : 3);
  const headGeometry = new ConeGeometry(.018, .07, detailed ? 4 : 3);
  const wood = new MeshStandardMaterial({ color: 0x77512d, roughness: .8 });
  const iron = new MeshStandardMaterial({ color: 0x899198, roughness: .45, metalness: .65 });
  const stone = new MeshStandardMaterial({ color: 0x73796a, roughness: .86 });
  const javelinShaft = new CylinderGeometry(.009, .009, 1.08, detailed ? 8 : 4);
  const javelinHead = new ConeGeometry(.024, .16, detailed ? 6 : 3);
  javelinHead.scale(1, 1, .4);
  const boulderGeometry = createCatapultRockGeometry(detailed);
  const boulderMaterial = createCatapultRockMaterial(detailed);
  const marbleShot = createMarbleShotKit(detailed);
  const arrows = new Map<number, Group>();
  const clouds = new Map<number, Sprite[]>();
  const boulders = new Map<number, NonNullable<MilitaryArrow["boulder"]>>();
  const impacts: { born: number; sprite: Sprite }[] = [];
  const texture = createSmokeTexture();
  const direction = new Vector3(), up = new Vector3(0, 1, 0), rotation = new Quaternion();
  const clearCloud = (sprites: Sprite[]) => {
    for (const sprite of sprites) { sprite.material.dispose(); sprite.removeFromParent(); }
  };
  return {
    root,
    smoke,
    update: (
      frames: readonly (MilitaryArrow & { visualWeapon?: "arrow" | "bolt" | "javelin" })[], deaths: readonly MilitaryDeathFrame[],
      playerColor: readonly [number, number, number] = NEUTRAL_FACTION_COLOR
    ) => {
      const now = performance.now();
      const active = new Set(frames.map(arrow => arrow.id));
      for (const [id, aim] of boulders) {
        if (active.has(id)) continue;
        const sprite = new Sprite(new SpriteMaterial({ color: 0x938572, depthWrite: false,
          map: texture, opacity: .4, transparent: true }));
        sprite.position.set(aim.x, aim.y + .12, aim.z); root.add(sprite);
        impacts.push({ born: now, sprite }); boulders.delete(id);
      }
      for (let index = impacts.length - 1; index >= 0; index--) {
        const impact = impacts[index]!, age = (now - impact.born) / 1000;
        if (age >= .35) {
          impact.sprite.material.dispose(); impact.sprite.removeFromParent(); impacts.splice(index, 1); continue;
        }
        impact.sprite.scale.setScalar(.20 + Math.min(1, age / .35) * CATAPULT_IMPACT_RADIUS * 2);
        impact.sprite.material.opacity = .4 * (1 - age / .35);
      }
      for (const [id, mesh] of arrows) if (!active.has(id)) { mesh.removeFromParent(); arrows.delete(id); }
      for (const arrow of frames) {
        if (arrow.boulder) boulders.set(arrow.id, arrow.boulder);
        let mesh = arrows.get(arrow.id);
        if (!mesh) {
          mesh = new Group();
          const javelin = arrow.visualWeapon === "javelin", bolt = arrow.visualWeapon === "bolt";
          mesh.name = `military_${arrow.visualWeapon ?? "arrow"}_projectile`;
          const shaft = new Mesh(javelin ? javelinShaft : shaftGeometry, wood);
          const head = new Mesh(javelin ? javelinHead : headGeometry, javelin && arrow.faction === 0 ? stone : iron);
          head.position.y = javelin ? .62 : .255;
          if (arrow.boulder) {
            mesh.name = "military_boulder_projectile";
            mesh.add(arrow.boulder.kind === "marble" ? marbleShot.create(1)
              : new Mesh(boulderGeometry, tintCatapultMaterial(boulderMaterial, arrow.boulder.kind)));
          }
          else mesh.add(shaft, head);
          root.add(mesh); arrows.set(arrow.id, mesh);
          if (bolt) mesh.scale.set(1.15, .62, 1.15);
        }
        const rest = arrow.boulder?.restAge, roll = arrow.boulder?.roll;
        const sink = rest === undefined ? 0 : Math.max(0, Math.min(1, (rest - 3) / 1.5));
        const diameter = arrow.boulder?.diameter ?? .32;
        // A rolling sphere sits on the ground; the lift fades out while it sinks.
        const lift = roll ? diameter * .5 * (1 - sink) : 0;
        mesh.position.set(arrow.x, arrow.y + lift - sink * .20, arrow.z);
        if (arrow.boulder) mesh.scale.setScalar(diameter * (1 - sink * .18));
        if (roll) {
          // Turned about the horizontal axis across its bearing by the distance rolled.
          direction.set(roll.dz, 0, -roll.dx);
          mesh.quaternion.setFromAxisAngle(direction, roll.distance / Math.max(.01, diameter / 2));
        } else if (rest !== undefined) mesh.quaternion.identity();
        else {
          direction.set(arrow.vx, arrow.vy, arrow.vz).normalize();
          mesh.quaternion.copy(rotation.setFromUnitVectors(up, direction));
        }
      }
      const dying = new Set(deaths.map(death => death.id));
      for (const [id, sprites] of clouds) if (!dying.has(id)) { clearCloud(sprites); clouds.delete(id); }
      for (const death of deaths) {
        let sprites = clouds.get(death.id);
        if (!sprites) {
          const color = smokeColor(death.faction, playerColor);
          const count = deathSmokePuffCount(deathSmokeBody(death), detailed);
          sprites = Array.from({ length: count }, () => {
            const sprite = new Sprite(createSmokeMaterial(texture));
            sprite.material.color.setRGB(...color); smoke.add(sprite); return sprite;
          });
          clouds.set(death.id, sprites);
        }
        // The cloud covers the whole figure (rider and horse too) while it falls and lies.
        for (let index = 0; index < sprites.length; index++) {
          const sprite = sprites[index]!, puff = deathSmokePuff(death, index, detailed, death.id);
          sprite.position.set(puff.x, puff.y, puff.z);
          sprite.scale.setScalar(puff.scale);
          sprite.material.opacity = puff.opacity;
          sprite.material.rotation = index * 2.1 + death.id + death.age * (index % 2 ? .25 : -.25);
        }
      }
    },
    dispose: () => {
      for (const impact of impacts) { impact.sprite.material.dispose(); impact.sprite.removeFromParent(); }
      impacts.length = 0; boulders.clear();
      for (const sprites of clouds.values()) clearCloud(sprites);
      disposeCatapultRockMaterial(boulderMaterial); boulderGeometry.dispose(); marbleShot.dispose(); shaftGeometry.dispose(); headGeometry.dispose(); javelinShaft.dispose(); javelinHead.dispose();
      wood.dispose(); iron.dispose(); stone.dispose(); texture.dispose();
      root.clear(); root.removeFromParent(); smoke.clear(); smoke.removeFromParent();
      arrows.clear(); clouds.clear();
    }
  };
};
