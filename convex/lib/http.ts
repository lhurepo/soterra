// [S] HTTP helpers shared by HTTP actions: JSON responses, error envelope, auth and contract checks.
import type { z } from "zod";
import { checkBearer } from "../../src/config/auth";
import { loadConfig, type Config } from "../../src/config/env";
import { CONTRACT_VERSION, type ErrorResponse } from "../../src/contracts";

export function config(): Config {
  return loadConfig(process.env);
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function errorResponse(status: number, code: ErrorResponse["error"]["code"], message: string): Response {
  return json({ error: { code, message } } satisfies ErrorResponse, status);
}

/** Returns a 401 Response unless the request carries `Authorization: Bearer <VOICE_API_SECRET>`. */
export function requireVoiceAuth(req: Request, cfg: Config): Response | null {
  if (!cfg.VOICE_API_SECRET) return errorResponse(401, "unauthorized", "VOICE_API_SECRET is not configured on the backend");
  return checkBearer(req.headers.get("Authorization"), cfg.VOICE_API_SECRET)
    ? null
    : errorResponse(401, "unauthorized", "missing or invalid bearer token");
}

/** Parses the body with a zod schema and checks the contract major version. */
export async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: errorResponse(400, "bad_request", "body must be JSON") };
  }
  const version = (raw as { contractVersion?: unknown } | null)?.contractVersion;
  if (typeof version === "string" && version.split(".")[0] !== CONTRACT_VERSION.split(".")[0]) {
    return {
      ok: false,
      response: errorResponse(400, "contract_version_mismatch", `backend speaks contract ${CONTRACT_VERSION}, got ${version}`),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return { ok: false, response: errorResponse(400, "bad_request", message) };
  }
  return { ok: true, data: parsed.data };
}
