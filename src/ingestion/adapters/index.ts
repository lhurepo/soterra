// [I] Adapter lookup by sourceId.
import { femaAdapter } from "./fema";
import { hansAdapter } from "./hans";
import { inciwebAdapter } from "./inciweb";
import { nhcAdapter } from "./nhc";
import { nwsAdapter } from "./nws";
import { shelterPageAdapter, websiteContentAdapter } from "./scraped";
import { tsunamiAdapter } from "./tsunami";
import type { ApifyAdapter, DirectAdapter } from "./types";
import { usgsAdapter } from "./usgs";
import { wfigsAdapter } from "./wfigs";
import { DEMO_SITES } from "../../../demo/scenario";
import { xAdapter, xFeedAdapter } from "./x";

export const DIRECT_ADAPTERS: Record<string, DirectAdapter> = Object.fromEntries(
  [nwsAdapter, usgsAdapter, femaAdapter, nhcAdapter, tsunamiAdapter, inciwebAdapter, wfigsAdapter, hansAdapter].map((a) => [a.sourceId, a]),
);

export const APIFY_ADAPTERS: Record<string, ApifyAdapter> = Object.fromEntries(
  [
    websiteContentAdapter("mock_county_emergency"),
    shelterPageAdapter("mock_shelters"),
    websiteContentAdapter("mock_disaster_assistance"),
    xAdapter,
    ...DEMO_SITES.map((site) =>
      site.pageFunction === "x-feed"
        ? xFeedAdapter(site.sourceId)
        : site.pageFunction === "shelters"
          ? shelterPageAdapter(site.sourceId)
          : websiteContentAdapter(site.sourceId),
    ),
  ].map((a) => [a.sourceId, a]),
);
