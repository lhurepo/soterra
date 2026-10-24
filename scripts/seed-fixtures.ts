// [S] npm run seed:fixtures — loads the Ridgeview demo bulletins (through upsertBulletins) and the mock sites.
// Fixtures are only spoken to callers when the deployment has SERVE_FIXTURES=true.
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, convexRun, readJson, readText } from "./lib/env";

export function seedFixtureSet(file: string, withMockSites: boolean) {
  const bulletins = readJson<unknown[]>(`fixtures/normalized/${file}`);
  // Both mock-site variants (v1 initial, v2 escalated); the active one is chosen by mockSites:setVariant.
  const mockSites = withMockSites
    ? (["v1", "v2"] as const).flatMap((variant) =>
        readdirSync(resolve(ROOT, "fixtures/mock-sites", variant))
          .filter((f) => f.endsWith(".html"))
          .map((f) => ({ path: f, variant, contentType: "text/html; charset=utf-8", body: readText(`fixtures/mock-sites/${variant}/${f}`) })),
      )
    : undefined;
  return convexRun("dev:seedFixtures", { bulletins, mockSites });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const results = seedFixtureSet("ridgeview-initial.json", true);
  console.log(JSON.stringify(results, null, 2));
  console.log("\nSeeded. Make sure SERVE_FIXTURES=true is set on the deployment: npx convex env set SERVE_FIXTURES true");
}
