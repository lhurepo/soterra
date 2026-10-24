// [B] Caller memory rules. A phone number is not an account: caller ID can be spoofed, so personal
// details are only shown to the model when the call is linked to a verified account.
import type { CallerContext } from "../contracts";

/** What the model may see. Stored needs and past summaries stay server-side unless identity is verified. */
export function toLlmContext(context: CallerContext): CallerContext {
  if (context.identity === "verified_account") return context;
  return {
    callerId: context.callerId,
    identity: context.identity,
    language: context.language,
    // County-level area only: it scopes retrieval and is not a personal detail.
    knownArea: context.knownArea
      ? { state: context.knownArea.state, county: context.knownArea.county, countyFips: context.knownArea.countyFips, label: context.knownArea.label }
      : undefined,
  };
}
