import { createExternalStore, type ExternalStore } from "../components/ui-store";

/**
 * An opener token (trigger design §6.10, rev m3): the subject (quest, mail) the window's next opening starts on.
 * The window keeps its own selection state; the token only seeds it for the opening whose count it names, so a
 * later player open starts on the default again.
 */
export interface OpenRequest {
  opened: number;
  subjectId: string;
}

export type OpenRequestStore = ExternalStore<OpenRequest | null>;

export const createOpenRequest = (): OpenRequestStore => createExternalStore<OpenRequest | null>(null);

/** The subject requested for this opening, else "" (the window's default selection). */
export const requestedSubject = (request: OpenRequest | null, opened: number) =>
  request?.opened === opened ? request.subjectId : "";
