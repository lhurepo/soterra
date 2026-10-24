// [S] HTTP router only. Handlers live in their owners' files. Served on the deployment's .convex.site URL.
import { httpRouter } from "convex/server";
import { appStateHttp } from "./app";
import { mockSite } from "./mockSites";
import { health } from "./health";
import { apifyWebhook } from "./ingestion";
import { sessionEnd, sessionStart, turn } from "./voice";

const http = httpRouter();

// [B] Live call (docs/contracts/live-call.md). Reserved, not built: POST /voice/turn/stream (NDJSON).
http.route({ path: "/voice/session/start", method: "POST", handler: sessionStart });
http.route({ path: "/voice/turn", method: "POST", handler: turn });
http.route({ path: "/voice/session/end", method: "POST", handler: sessionEnd });
http.route({ path: "/health", method: "GET", handler: health });

// [B] Public read-only feed for the iOS app (convex/app.ts).
http.route({ path: "/app/state", method: "GET", handler: appStateHttp });

// [I] Apify run webhook.
http.route({ path: "/ingest/apify", method: "POST", handler: apifyWebhook });

// [I] Dev only (404 unless ENABLE_MOCK_SITES=true).
http.route({ pathPrefix: "/mock-sites/", method: "GET", handler: mockSite });

export default http;
