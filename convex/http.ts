// [S] HTTP router only. Handlers live in their owners' files. Served on the deployment's .convex.site URL.
import { httpRouter } from "convex/server";
import { appStateHttp } from "./app";
import { demoStartHttp, demoStatusHttp, demoStopHttp } from "./demo";
import { mockSite } from "./mockSites";
import { relayClaim, relayResult } from "./smsRelay";
import { health } from "./health";
import { apifyWebhook } from "./ingestion";
import { twilioInbound, twilioStatus } from "./twilio";
import { sessionEnd, sessionStart, turn } from "./voice";

const http = httpRouter();

// [B] Live call (docs/contracts/live-call.md). Reserved, not built: POST /voice/turn/stream (NDJSON).
http.route({ path: "/voice/session/start", method: "POST", handler: sessionStart });
http.route({ path: "/voice/turn", method: "POST", handler: turn });
http.route({ path: "/voice/session/end", method: "POST", handler: sessionEnd });
http.route({ path: "/health", method: "GET", handler: health });

// [B] Public read-only feed for the iOS app (convex/app.ts).
http.route({ path: "/app/state", method: "GET", handler: appStateHttp });

// [B] Twilio texts: delivery status callbacks and incoming texts (STOP). Signed with TWILIO_AUTH_TOKEN.
http.route({ path: "/twilio/status", method: "POST", handler: twilioStatus });
http.route({ path: "/twilio/inbound", method: "POST", handler: twilioInbound });

// [B] Mac Messages relay (SMS_NOTIFIER=mac_relay; convex/smsRelay.ts). Bearer SMS_RELAY_SECRET.
http.route({ path: "/relay/claim", method: "POST", handler: relayClaim });
http.route({ path: "/relay/result", method: "POST", handler: relayResult });

// [S] Demo switch for the app's button (convex/demo.ts). Bearer DEMO_SECRET.
http.route({ path: "/demo/start", method: "POST", handler: demoStartHttp });
http.route({ path: "/demo/stop", method: "POST", handler: demoStopHttp });
http.route({ path: "/demo/status", method: "GET", handler: demoStatusHttp });

// [I] Apify run webhook.
http.route({ path: "/ingest/apify", method: "POST", handler: apifyWebhook });

// [I] Dev only (404 unless ENABLE_MOCK_SITES=true).
http.route({ pathPrefix: "/mock-sites/", method: "GET", handler: mockSite });

export default http;
