// Every claim carries the exact source text that states it. Code, not a
// model, decides whether that text is really in the source.

/** Folds the differences introduced when text is copied between formats. */
export function normalizeForQuote(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201B]/gu, "'")
    .replace(/[\u201C\u201D\u201F]/gu, '"')
    .replace(/[\u2010-\u2015\u2212]/gu, "-")
    // Bullets and Markdown markup; `#` stays so C# and F# remain distinct.
    .replace(/[\u2022\u25AA\u25CF*_`>|[\]()]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

/** Shortest quote that can support a claim; blocks "a", "and", "-". */
const minimumQuoteLength = 3;

export function isQuoted(quote: string, source: string): boolean {
  const needle = normalizeForQuote(quote);
  return (
    needle.length >= minimumQuoteLength &&
    /[\p{L}\p{N}]/u.test(needle) &&
    normalizeForQuote(source).includes(needle)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** True when `term` appears in `text` as a whole word or phrase. */
export function containsTerm(text: string, term: string): boolean {
  const needle = normalizeForQuote(term);
  if (!needle) return false;
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`,
    "u",
  ).test(normalizeForQuote(text));
}
