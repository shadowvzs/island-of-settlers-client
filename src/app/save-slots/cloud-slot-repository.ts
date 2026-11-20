import { ONLINE_STORY_SLOT_MODE, type SlotMeta } from "../../../../island-of-settlers-shared/src/offline-slots";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import type { PlayerAccount } from "../account/account-boot";
import type { CloudSession } from "../cloud/cloud-boot";
import { createSaveApiClient, type SaveApiOptions } from "../save-store/save-api-client";
import { fromSaveSnapshot } from "../save-store/save-snapshot";
import { CLOUD_SLOT_KEEPS_WORKING, SAVE_SLOT_NUMBERS } from "./constants";
import { createOfflineSlotsClient, type OfflineSlotsClient } from "./offline-slots-client";
import { serverSaveSlots } from "./server-slot-repository";
import { encodeDumpJson, gzipText, parseDumpJson } from "./slot-dump";
import { buildSlotMeta, type SlotSource } from "./slot-meta";
import type { SlotRepository } from "./slot-repository";

/**
 * Save/Load slots of signed-in online play without a home island (owner D1b: only while campaign rewards are off;
 * OFFLINE-CLOUD). The working slot is the verified cloud slot; a Save/Load slot is a copy of its game in the api's
 * unverified store (`online` mode). Save reads the cloud slot's last confirmed game (the page saved it first) without
 * touching the running store; Load writes the copy back through the verified save API (lease, rules and upload
 * checks as every save), so the unverified store itself never gives online value.
 */

/** One online copy as stored. */
export interface CloudSlotCopy {
  meta: SlotMeta;
  save: GameSaveV1;
}

export interface CloudSlotRepositoryOptions {
  api: OfflineSlotsClient;
  cloud: Pick<CloudSession, "initialGame" | "store">;
  now: () => number;
  /** The cloud slot's confirmed game, read without changing the running store's revision or command logs. */
  readServerGame: () => Promise<GameSaveV1 | null>;
  workingSlotId: string;
}

/** What a copy shows: the campaign run on screen, its player level. */
export const cloudSaveSource = (save: GameSaveV1): SlotSource => {
  const run = save.campaignRun;
  return {
    colonies: [],
    ...(save.player ? { player: { progress: save.player } } : {}),
    session: run ? { active: "campaign", campaign: { campaignId: run.campaignId, mapId: run.mapId } }
      : { active: null }
  };
};

const decodeCopy = (json: ArrayBuffer): CloudSlotCopy => {
  const copy = parseDumpJson(new TextDecoder().decode(json)) as Partial<CloudSlotCopy> | null;
  if (!copy?.save || typeof copy.save !== "object") throw new Error("The downloaded slot is malformed");
  return copy as CloudSlotCopy;
};

const saveSlotNumber = (number: number) => {
  if (!SAVE_SLOT_NUMBERS.includes(number)) throw new RangeError(`Save slot ${number} is outside the slot list`);
  return number;
};

export const createCloudSlotRepository = (options: CloudSlotRepositoryOptions): SlotRepository => {
  const { api, cloud, workingSlotId } = options;
  const keepsWorking = () => Promise.reject(new Error(CLOUD_SLOT_KEEPS_WORKING));
  /** Throws while the cloud slot has a save the server has not confirmed. */
  const assertConfirmed = async (message: string) => {
    await cloud.store.whenIdle?.();
    if (cloud.store.hasPendingUpload?.()) throw new Error(message);
  };
  /** The copy becomes the cloud slot's game; an upload the server did not confirm fails the Load. */
  const writeBack = async (save: GameSaveV1) => {
    await cloud.store.writeSavedGame(save);
    await assertConfirmed("The loaded game could not be saved on the server");
    cloud.initialGame = save;
  };
  return {
    discardWorking: keepsWorking,
    list: async () => serverSaveSlots(workingSlotId, await api.list(ONLINE_STORY_SLOT_MODE)),
    loadIntoWorking: async number => {
      const json = await api.download(ONLINE_STORY_SLOT_MODE, saveSlotNumber(number));
      if (!json) throw new Error(`Save slot ${number} is empty`);
      await writeBack(decodeCopy(json).save);
    },
    newGame: keepsWorking,
    remove: number => api.remove(ONLINE_STORY_SLOT_MODE, saveSlotNumber(number)),
    saveFromWorking: async (number, input) => {
      await assertConfirmed("The game is not saved on the server yet");
      const save = await options.readServerGame();
      if (!save) throw new Error("The cloud slot holds no game to save");
      const meta = buildSlotMeta({ ...input, savedAt: options.now() }, cloudSaveSource(save));
      const body = await gzipText(encodeDumpJson({ meta, save } satisfies CloudSlotCopy));
      await api.upload(ONLINE_STORY_SLOT_MODE, saveSlotNumber(number), body);
    },
    workingSlotId
  };
};

/** A side-effect free read of the cloud slot's confirmed game (the running store keeps its state). */
export const cloudGameReader = (access: SaveApiOptions, slotId: string) => {
  const api = createSaveApiClient(access);
  return async () => fromSaveSnapshot(await api.readSnapshot(slotId));
};

/** A signed-in cloud slot without a home: the session that owns the copies. */
export interface CloudSlotOwner {
  account: PlayerAccount;
  cloud: CloudSession;
}

export const openCloudSlotRepository = ({ account, cloud }: CloudSlotOwner, workingSlotId: string) => {
  const { backend, identity } = account;
  const access = { apiUrl: backend.apiUrl, getAccessToken: identity.accessToken, renewAccessToken: identity.renew };
  return createCloudSlotRepository({ api: createOfflineSlotsClient(access), cloud, now: Date.now,
    readServerGame: cloudGameReader(access, cloud.slot.id), workingSlotId });
};
