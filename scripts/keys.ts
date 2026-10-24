// [B] npm run key:add -- sk-ant-… [sk-ant-… …]   add keys to the pool on the deployment in .env.local
//     npm run key:list                           how many keys, and the last 4 characters of each (never the keys)
//     npm run key:clear                          drop the extra keys (the primary ANTHROPIC_API_KEY stays)
// The backend moves to the next key by itself when one runs out of credit (src/providers/llm/pool.ts).
import { spawnSync } from "node:child_process";
import { parseKeyPool } from "../src/providers/llm/pool";

const convex = (args: string[]) => spawnSync("npx", ["convex", ...args], { encoding: "utf8" });
const get = (name: string): string | undefined => {
  const r = convex(["env", "get", name]);
  const value = r.status === 0 ? r.stdout.trim() : "";
  return value || undefined;
};
const set = (name: string, value: string) => {
  const r = convex(["env", "set", name, value]);
  if (r.status !== 0) throw new Error(r.stderr.trim() || `could not set ${name}`);
};
const tail = (key: string) => `…${key.slice(-4)}`;

const [command, ...rest] = process.argv.slice(2);
const primary = get("ANTHROPIC_API_KEY");
const extras = parseKeyPool(undefined, get("ANTHROPIC_API_KEYS"));

if (command === "add") {
  const incoming = rest.flatMap((arg) => parseKeyPool(undefined, arg));
  if (incoming.length === 0) throw new Error("usage: npm run key:add -- sk-ant-… [more keys]");
  const already = new Set([primary, ...extras]);
  const fresh = incoming.filter((k) => !already.has(k));
  const next = [...extras, ...fresh];
  set("ANTHROPIC_API_KEYS", next.join(","));
  console.log(`Added ${fresh.length} key(s)${incoming.length > fresh.length ? ` (${incoming.length - fresh.length} already there)` : ""}: ${fresh.map(tail).join(" ")}`);
} else if (command === "clear") {
  convex(["env", "remove", "ANTHROPIC_API_KEYS"]);
  console.log("Extra keys removed. The primary ANTHROPIC_API_KEY is unchanged.");
} else if (command !== "list") {
  throw new Error("usage: npm run key:add -- <key…> | key:list | key:clear");
}

const all = parseKeyPool(primary, get("ANTHROPIC_API_KEYS"));
console.log(`Pool on this deployment: ${all.length} key(s)${all.length ? ` [${all.map(tail).join(" ")}]` : ""}; the first is the primary.`);
