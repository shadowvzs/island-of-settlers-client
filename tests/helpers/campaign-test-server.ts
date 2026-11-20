import { createMemoryCampaignMapFiles } from "../../../island-of-settlers-api/src/campaign/campaign-map-files";
import {
  registerCampaignPublishedRoutes
} from "../../../island-of-settlers-api/src/campaign/campaign-published-routes";
import { registerCampaignRoutes } from "../../../island-of-settlers-api/src/campaign/campaign-routes";
import { createBackendService, ServiceError } from "../../../island-of-settlers-shared/server/service";
import {
  createMemoryCampaignRecordStore, createStoreCampaignRepositories
} from "../../../island-of-settlers-shared/src/campaign/campaign-store-repository";
import type { AccessClaims } from "../../../island-of-settlers-shared/src/contracts";
import type { SaveApiOptions } from "../../src/app/save-store/save-api-client";

const API_URL = "http://api.test";

type Role = "admin" | "player";

/**
 * The real campaign routes of the API over memory stores, reached through a `fetch` that injects into the
 * service: client code is tested against the routes it will call. The bearer token is the caller's role.
 */
export const createCampaignTestServer = (now: () => number = Date.now) => {
  const service = createBackendService({
    config: { corsOrigins: [], databaseUrl: "postgresql://unused", host: "127.0.0.1", logLevel: "silent", port: 3002,
      publicUrl: API_URL, service: "api" },
    logging: false,
    readiness: async () => true
  });
  const authenticate = async (request: { headers: Record<string, unknown> }) => {
    const role = String(request.headers.authorization ?? "").replace("Bearer ", "");
    if (role !== "admin" && role !== "player") throw new ServiceError("AUTH_REQUIRED", 401, "Sign in");
    return { role, sub: "test-account" } as AccessClaims;
  };
  const repositories = createStoreCampaignRepositories(createMemoryCampaignRecordStore(), now);
  const mapFiles = createMemoryCampaignMapFiles(now);
  registerCampaignRoutes(service, repositories, authenticate as never, mapFiles);
  registerCampaignPublishedRoutes(service, repositories, mapFiles, authenticate as never, now);
  let online = true;
  const request = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (!online) throw new TypeError("Failed to fetch");
    const answer = await service.inject({
      headers: init.headers as Record<string, string>, method: (init.method ?? "GET") as "GET",
      payload: init.body as string | undefined, url: String(input).slice(API_URL.length)
    });
    return new Response(new Uint8Array(answer.rawPayload), {
      headers: answer.headers as Record<string, string>, status: answer.statusCode
    });
  }) as typeof fetch;
  const access = (role: Role | "guest"): SaveApiOptions =>
    ({ apiUrl: API_URL, fetch: request, getAccessToken: async () => role });
  return {
    access,
    close: () => service.close(),
    mapFiles,
    repositories,
    setOnline: (value: boolean) => { online = value; }
  };
};

export type CampaignTestServer = ReturnType<typeof createCampaignTestServer>;
