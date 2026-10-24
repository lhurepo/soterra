// [S] Two projects: pure TS tests in tests/ (node) and Convex function tests in convex/ (edge-runtime, convex-test).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: "unit", include: ["tests/**/*.test.ts"], environment: "node" },
      },
      {
        test: {
          name: "convex",
          include: ["convex/**/*.test.ts"],
          environment: "edge-runtime",
          server: { deps: { inline: ["convex-test"] } },
        },
      },
    ],
  },
});
