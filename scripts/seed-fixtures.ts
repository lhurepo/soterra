// [S] npm run seed:fixtures — loads the Ridgeview demo bulletins (through upsertBulletins) and the mock sites.
// Fixtures are only spoken to callers when the deployment has SERVE_FIXTURES=true.
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, convexRun, readJson, readText } from "./lib/env";

export function seedFixtureSet(file: string, withMockSites: boolean) {
  const bulletins = readJson<unknown[]>(`fixtures/normalized/${file}`);
  const mockSites = withMockSites
    ? readdirSync(resolve(ROOT, "fixtures/mock-sites"))
        .filter((f) => f.endsWith(".html"))
        .map((f) => ({ path: f, contentType: "text/html; charset=utf-8", body: readText(`fixtures/mock-sites/${f}`) }))
    : undefined;
  return convexRun("dev:seedFixtures", { bulletins, mockSites });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const results = seedFixtureSet("ridgeview-initial.json", true);
  console.log(JSON.stringify(results, null, 2));
  console.log("\nSeeded. Make sure SERVE_FIXTURES=true is set on the deployment: npx convex env set SERVE_FIXTURES true");
}
