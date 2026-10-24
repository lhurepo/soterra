// [I] Mock Apify datasets (fixture mode), keyed by sourceId and mock-site variant. Each file is shaped
// exactly like the real actor's dataset items; tests check they match fixtures/mock-sites/<variant>/*.html.
import type { MockDatasets } from "../providers/apify/mock";
import countyV1 from "../../fixtures/apify/v1/mock_county_emergency.json";
import countyV2 from "../../fixtures/apify/v2/mock_county_emergency.json";
import assistanceV1 from "../../fixtures/apify/v1/mock_disaster_assistance.json";
import assistanceV2 from "../../fixtures/apify/v2/mock_disaster_assistance.json";
import sheltersV1 from "../../fixtures/apify/v1/mock_shelters.json";
import sheltersV2 from "../../fixtures/apify/v2/mock_shelters.json";
import social from "../../fixtures/social/x-posts.json";

export const MOCK_APIFY_DATASETS: MockDatasets = {
  mock_county_emergency: { v1: countyV1, v2: countyV2 },
  mock_disaster_assistance: { v1: assistanceV1, v2: assistanceV2 },
  mock_shelters: { v1: sheltersV1, v2: sheltersV2 },
  x_posts: { v1: social.items, v2: social.items },
};
