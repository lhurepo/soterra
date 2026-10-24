// [B] Small text helpers for search: tokenizing, stopwords, Convex search-term limits.

const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can could do does for from had has have how i i'm if in is it its " +
    "me my near of on or our please should so tell that the their them there these this to us was we " +
    "what what's whats when where which who why will with would you your going happening any about know " +
    "el la los las un una de del en y o que qué es está hay por para mi me se cerca"
  ).split(/\s+/),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFC")
    .split(/[^\p{L}\p{N}'-]+/u)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ""))
    .filter(Boolean);
}

export function contentTerms(text: string): string[] {
  return [...new Set(tokenize(text).filter((t) => !STOPWORDS.has(t) && t.length > 1))];
}

/** Convex search allows up to 16 terms of up to 32 characters each. */
export function searchText(text: string): string {
  return contentTerms(text)
    .map((t) => t.slice(0, 32))
    .slice(0, 16)
    .join(" ");
}

/** Capitalized words that are not sentence-initial, e.g. "Ridgeview", "Hillcrest Elementary". */
export function properNouns(utterance: string): string[] {
  const words = utterance.split(/\s+/);
  const nouns: string[] = [];
  words.forEach((raw, i) => {
    const word = raw.replace(/[^\p{L}\p{N}'-]/gu, "");
    const sentenceStart = i === 0 || /[.?!]$/.test(words[i - 1] ?? "");
    if (!sentenceStart && /^\p{Lu}/u.test(word) && word !== "I" && !STOPWORDS.has(word.toLowerCase())) {
      nouns.push(word.toLowerCase());
    }
  });
  return nouns;
}

/** Fraction of the query's content terms present in the text (prefix match, so "shelter" hits "shelters"). */
export function termOverlap(query: string, text: string): number {
  const terms = contentTerms(query);
  if (terms.length === 0) return 0;
  const hay = new Set(tokenize(text));
  const hits = terms.filter(
    (t) => hay.has(t) || [...hay].some((h) => h.startsWith(t) || (h.length >= 4 && t.startsWith(h))),
  );
  return hits.length / terms.length;
}
