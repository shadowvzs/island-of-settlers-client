import type { PlayerProgress } from "../../shared/progression/player-progress";
import type { ArchivedIslandProof } from "../../shared/settlement/archived-relief-journal";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import type { CapturedGame } from "./captured-game";

/**
 * The one seam between the game and its persistence (backend plan 2026-10-22): every save and load goes
 * through a SaveStore. `LocalSaveStore` keeps the browser save (guest / offline play, the default);
 * `RemoteSaveStore` will keep an account's game on the save API. The game never knows which one it uses.
 *
 * A game is one `GameSaveV1`: the home island, colony and adventure islands, evacuations, player progress and
 * the session (active island, rewards). It travels as an object (no JSON round trip on the main thread);
 * export/import files are its JSON text.
 */
export interface SaveStore {
  /** Where the game is kept: this browser (guests) or the signed-in account's cloud slot. */
  readonly location: "account" | "browser";
  /** The complete saved game; null when the slot has none. */
  readSavedGame(): Promise<GameSaveV1 | null>;
  /** Replaces the complete saved game (every island, expedition, player and session row at once). */
  writeSavedGame(save: GameSaveV1): Promise<void>;
  /** Durably stores a filed-island journal; an acknowledged canonical return may clear only its proof metadata. */
  writeArchivedIslandGame?(save: GameSaveV1, proof: ArchivedIslandProof): Promise<GameSaveV1 | void>;
  /** Saves the running game from its tick-boundary capture; building and serializing it run off the frame. */
  writeCapturedGame(captured: CapturedGame): Promise<void>;
  /** The game staged for the next page load (Load game, island travel, background resume); null when none. */
  readStartupGame(): Promise<string | null>;
  writeStartupGame(json: string): Promise<void>;
  clearStartupGame(): Promise<void>;
  /** The reproduction report of a recording that ended with an island visit (development tools). */
  readReplayReport(): Promise<string | null>;
  writeReplayReport(json: string): Promise<void>;
  /** Waits for accepted writes/uploads to settle without starting a retry; absent when writes are synchronous. */
  whenIdle?(): Promise<void>;
  /**
   * Cloud stores only: settles accepted uploads and says whether the slot's revision still matches this
   * client (`current`), moved on elsewhere (`newer`), or could not be read (`unknown`).
   */
  checkAuthority?(): Promise<"current" | "newer" | "unknown">;
  /** Cloud stores only: true while a local save is still waiting for its upload. */
  hasPendingUpload?(): boolean;
  /**
   * No-home play (GS3a; cloud slots since ONLINE-STORY): the slot's player progress kept between runs; null when
   * none. A slot without a home holds no island rows between runs: the progress lives in the browser slot's boot
   * value, or in the cloud slot's player row (the last read or story write).
   */
  readStoryProgress?(): Promise<PlayerProgress | null>;
  /** A run without a home ended: keep `player`, clear the slot's game rows (a cloud slot uploads at once). */
  endRunWithoutHome?(player: PlayerProgress): Promise<void>;
}
