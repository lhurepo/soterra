// [B] Errors shared by every provider adapter.

/** Thrown when a live adapter is selected but its env vars are missing. Names the missing vars. */
export class NotConfiguredError extends Error {
  constructor(
    readonly integration: string,
    readonly missingEnv: string[],
  ) {
    super(`${integration} is not configured: set ${missingEnv.join(", ")} (npx convex env set ...)`);
    this.name = "NotConfiguredError";
  }
}

/** Thrown by skeleton stubs that an owner still has to fill in. */
export class NotImplementedError extends Error {
  constructor(what: string, owner: string) {
    super(`${what} is not implemented yet (TODO(${owner}))`);
    this.name = "NotImplementedError";
  }
}
