// [B] Shared-secret checks for the voice API and inbound webhooks. Fails closed when unconfigured.

/** Length-independent comparison so response timing does not leak the secret. */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function checkBearer(authorizationHeader: string | null, secret: string | undefined): boolean {
  if (!secret || !authorizationHeader) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  return match !== null && timingSafeEqual(match[1], secret);
}
