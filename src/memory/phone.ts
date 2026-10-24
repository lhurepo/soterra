// [B] US-first E.164 normalization for caller IDs. Withheld or unparseable numbers become undefined
// (an ephemeral caller with no memory), never a guessed number.

const WITHHELD = /^(anonymous|restricted|private|unknown|unavailable|withheld|blocked)$/i;

export function normalizeE164(raw: string | undefined | null): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "" || WITHHELD.test(trimmed)) return undefined;
  const digits = trimmed.replace(/[^\d]/g, "");
  let e164: string;
  if (trimmed.startsWith("+")) e164 = `+${digits}`;
  else if (digits.length === 10) e164 = `+1${digits}`; // US national number
  else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
  else return undefined;
  return /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : undefined;
}
