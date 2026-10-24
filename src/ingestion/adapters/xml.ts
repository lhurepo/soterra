// [I] Minimal XML helpers for flat feeds (CAP, RSS). Convex's default runtime has no DOMParser, and these
// feeds only need a few non-repeating text elements, so a small, strict extractor is enough.

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    // HTML entities double-encoded inside XML (seen in InciWeb descriptions: "&amp;nbsp;").
    .replace(/&nbsp;/g, " ");
}

/** All elements named `tag` (optionally namespace-prefixed) as raw inner XML. */
export function elements(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, "g");
  return [...xml.matchAll(re)].map((m) => m[1]);
}

/** Text of the first `tag` element, entity-decoded and trimmed; undefined when absent or empty. */
export function text(xml: string, tag: string): string | undefined {
  const first = elements(xml, tag)[0];
  if (first === undefined) return undefined;
  const value = decodeEntities(first.replace(/<!--[\s\S]*?-->/g, "")).replace(/<[^>]+>/g, "").trim();
  return value === "" ? undefined : value;
}
