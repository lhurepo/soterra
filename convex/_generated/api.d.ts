/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as callers from "../callers.js";
import type * as calls from "../calls.js";
import type * as crons from "../crons.js";
import type * as dev from "../dev.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as ingestion from "../ingestion.js";
import type * as lib_http from "../lib/http.js";
import type * as llmCheck from "../llmCheck.js";
import type * as memory from "../memory.js";
import type * as mossNode from "../mossNode.js";
import type * as notifications from "../notifications.js";
import type * as retrieval from "../retrieval.js";
import type * as sources from "../sources.js";
import type * as subscriptions from "../subscriptions.js";
import type * as systemState from "../systemState.js";
import type * as unanswered from "../unanswered.js";
import type * as validators from "../validators.js";
import type * as voice from "../voice.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  callers: typeof callers;
  calls: typeof calls;
  crons: typeof crons;
  dev: typeof dev;
  health: typeof health;
  http: typeof http;
  ingestion: typeof ingestion;
  "lib/http": typeof lib_http;
  llmCheck: typeof llmCheck;
  memory: typeof memory;
  mossNode: typeof mossNode;
  notifications: typeof notifications;
  retrieval: typeof retrieval;
  sources: typeof sources;
  subscriptions: typeof subscriptions;
  systemState: typeof systemState;
  unanswered: typeof unanswered;
  validators: typeof validators;
  voice: typeof voice;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
